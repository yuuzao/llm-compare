import { LibraryService } from "../services/library.ts";
import { bodyLimit } from "hono/body-limit";
import { AttachmentService } from "../services/attachments.ts";
import { ProviderService } from "../services/providers.ts";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { embeddedWeb } from "./embedded-web.ts";
import { buildInfo } from "../version.ts";
import { SCHEMA_VERSION } from "../db/schema.ts";
import { serveStatic } from "@hono/node-server/serve-static";
import { libraryQuerySchema, libraryRefSchema, contentQuerySchema, listQuerySchema, projectListQuerySchema, runListQuerySchema, thoughtOptionsRequestSchema } from "@llm-compare/shared";
import { Hono, type Context } from "hono";
import { setCookie } from "hono/cookie";
import { ZodError, type z } from "zod";
import type { AppContext } from "../context.ts";
import { AppError } from "../errors.ts";
import { logger } from "../logger.ts";
import type { AgentService } from "../services/agents.ts";
import type { ConversationService } from "../services/conversations.ts";
import { convStream, runStream } from "../services/events.ts";
import type { MappingService } from "../services/mappings.ts";
import type { ProjectService } from "../services/projects.ts";
import type { RunService } from "../services/runs.ts";
import { buildVerifiedConfigs } from "../services/verified-agents.ts";
import { hostGuard, UI_COOKIE, writeGuard } from "./security.ts";
import { sseResponse } from "./sse.ts";

export type Services = {
  agents: AgentService;
  mappings: MappingService;
  projects: ProjectService;
  runs: RunService;
  conversations: ConversationService;
};

type Env = { Variables: { requestId: string } };

function query<S extends z.ZodType>(c: Context, schema: S): z.infer<S> {
  return schema.parse(c.req.query());
}

async function body(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new AppError("invalid_request", "请求体不是有效的 JSON");
  }
}

export function buildApp(ctx: AppContext, s: Services, uiToken: string): Hono<Env> {
  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    c.set("requestId", crypto.randomUUID());
    const started = performance.now();
    await next();
    if (c.req.path.startsWith("/api/")) {
      logger.debug({ requestId: c.get("requestId"), method: c.req.method, path: c.req.path, status: c.res.status, ms: Math.round(performance.now() - started) }, "HTTP 请求");
    }
  });
  app.use("*", hostGuard);

  app.onError((err, c) => {
    const requestId = c.get("requestId");
    if (err instanceof ZodError) {
      const fields = Object.fromEntries(err.issues.map((i) => [i.path.join(".") || "(根)", i.message]));
      return c.json({ error: { code: "invalid_request", message: "请求参数不合法", request_id: requestId, fields } }, 400);
    }
    if (err instanceof AppError) {
      if (err.status >= 500) logger.warn({ requestId, code: err.code, message: err.message }, "请求失败");
      return c.json({ error: { code: err.code, message: err.message, request_id: requestId, fields: err.fields } }, err.status as 400);
    }
    logger.error({ requestId, path: c.req.path, err: err instanceof Error ? err.stack : String(err) }, "未处理的服务端错误");
    return c.json({ error: { code: "internal_error", message: "服务端内部错误，请查看服务日志", request_id: requestId } }, 500);
  });

  const api = new Hono<Env>();
  api.use("*", writeGuard(uiToken));

  api.get("/ui-session", (c) => {
    setCookie(c, UI_COOKIE, uiToken, { httpOnly: true, sameSite: "Strict", path: "/" });
    return c.json({ ok: true });
  });

  // 外部只读接口
  api.get("/projects", (c) => {
    const q = query(c, projectListQuerySchema);
    return c.json(s.projects.list(q.query, q.limit, q.cursor, q.include_deleted === "true"));
  });
  api.get("/projects/:id", (c) => c.json(s.projects.get(c.req.param("id"))));
  api.get("/projects/:id/runs", (c) => {
    const q = query(c, runListQuerySchema);
    const { limit, cursor, include_deleted, ...f } = q;
    return c.json(s.runs.list(c.req.param("id"), { ...f, include_deleted: include_deleted === "true" }, limit, cursor));
  });
  api.get("/runs/:id", (c) => c.json(s.runs.packet(c.req.param("id"))));
  api.get("/runs/:id/attempts/:aid", (c) => c.json(s.runs.attempt(c.req.param("id"), c.req.param("aid"))));
  api.get("/runs/:id/attempts/:aid/content", (c) => c.json(s.runs.content(c.req.param("id"), c.req.param("aid"), query(c, contentQuerySchema))));
  api.get("/runs/:id/events", (c) => {
    const runId = c.req.param("id");
    s.runs.row(runId);
    const q = query(c, listQuerySchema);
    const after = q.cursor ? Number(q.cursor) : 0;
    if (!Number.isInteger(after) || after < 0) throw new AppError("invalid_request", "cursor 无效", { cursor: "必须是事件序号" });
    const items = ctx.events.list(runStream(runId), after, q.limit);
    return c.json({ items, next_cursor: items.length === q.limit ? String(items[items.length - 1]!.seq) : null });
  });
  api.get("/projects/:id/conversations", (c) => c.json({ items: s.conversations.list(c.req.param("id")), next_cursor: null }));
  api.get("/conversations/:id", (c) => c.json(s.conversations.view(c.req.param("id"))));
  api.get("/conversations/:id/messages", (c) => {
    const q = query(c, listQuerySchema);
    return c.json(s.conversations.messages(c.req.param("id"), q.limit, q.cursor));
  });

  const providers = new ProviderService(ctx);
  const attachments = new AttachmentService(ctx);
  api.get("/providers", (c) => c.json({ items: providers.list() }));
  api.post("/providers", async (c) => c.json(providers.save(await body(c)), 201));
  api.put("/providers/:id", async (c) => c.json(providers.save(await body(c), c.req.param("id"))));
  api.delete("/providers/:id", (c) => { providers.remove(c.req.param("id")); return c.body(null, 204); });
  api.post("/projects/:id/attachments", bodyLimit({ maxSize: ctx.config.limits.max_attachment_bytes + 65536, onError: () => { throw new AppError("invalid_request", "上传文件超过大小限制"); } }), async (c) => {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("invalid_request", "请选择附件文件");
    return c.json(await attachments.upload(c.req.param("id"), file), 201);
  });
  api.get("/attachments/:id/content", (c) => {
    const file = attachments.get(c.req.param("id"));
    c.header("Content-Type", file.mime_type);
    c.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    c.header("X-Content-Type-Options", "nosniff");
    return c.body(new Uint8Array(attachments.data(file)));
  });

  // 设置类读接口
  api.get("/agent-configs", (c) => c.json({ items: s.agents.list() }));
  api.get("/agent-configs/:id", (c) => c.json(s.agents.get(c.req.param("id"))));
  api.get("/agent-configs/:id/models", (c) => c.json({ items: s.agents.modelOptions(c.req.param("id")) }));
  api.get("/thought-levels", (c) => c.json({ items: s.mappings.listLevels() }));

  const library = new LibraryService(ctx);
  api.get("/library-items", (c) => c.json(library.list(query(c, libraryQuerySchema))));
  api.get("/library-items/:id", (c) => c.json(library.get(c.req.param("id"))));
  const libraryLimit = bodyLimit({ maxSize: ctx.config.limits.max_attachments_total_bytes + 1048576, onError: () => { throw new AppError("invalid_request", "保存内容超过大小限制"); } });
  async function libraryBody(c: Context) {
    if (c.req.header("content-type")?.startsWith("multipart/form-data")) {
      const form = await c.req.formData();
      const raw = form.get("data");
      if (typeof raw !== "string") throw new AppError("invalid_request", "缺少条目内容");
      let input: unknown;
      try { input = JSON.parse(raw); } catch { throw new AppError("invalid_request", "条目内容格式不合法"); }
      const files = form.getAll("files");
      if (files.some((f) => !(f instanceof File))) throw new AppError("invalid_request", "附件格式不合法");
      return { input, files: files as File[] };
    }
    return { input: await body(c), files: [] };
  }
  api.post("/library-items", libraryLimit, async (c) => { const { input, files } = await libraryBody(c); return c.json(await library.save(input, files), 201); });
  api.put("/library-items/:id", libraryLimit, async (c) => { const { input, files } = await libraryBody(c); return c.json(await library.save(input, files, c.req.param("id"))); });
  api.delete("/library-items/:id", (c) => { library.remove(c.req.param("id")); return c.body(null, 204); });
  api.post("/library-items/:id/restore", (c) => c.json(library.restore(c.req.param("id"))));
  api.post("/projects/:id/library-content", async (c) => c.json(library.apply(c.req.param("id"), libraryRefSchema.parse(await body(c))), 201));
  api.get("/library-attachments/:id/content", (c) => {
    const file = library.file(c.req.param("id"));
    c.header("Content-Type", file.mime_type); c.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`); c.header("X-Content-Type-Options", "nosniff");
    return c.body(new Uint8Array(library.data(file)));
  });

  // 前端写操作
  api.post("/projects", async (c) => c.json(s.projects.create(await body(c)), 201));
  api.patch("/projects/:id", async (c) => c.json(s.projects.patch(c.req.param("id"), await body(c))));
  api.delete("/projects/:id", (c) => c.json(s.projects.delete(c.req.param("id"))));
  api.post("/projects/:id/restore", (c) => c.json(s.projects.restore(c.req.param("id"))));
  api.post("/projects/:id/runs", async (c) => {
    const { run, created } = await s.runs.create(c.req.param("id"), await body(c));
    return c.json(run, created ? 201 : 200);
  });
  api.post("/runs/:id/cancel", (c) => {
    s.runs.cancelRun(c.req.param("id"));
    return c.json({ ok: true }, 202);
  });
  api.post("/runs/:id/attempts/:aid/cancel", (c) => {
    s.runs.cancelAttempt(c.req.param("id"), c.req.param("aid"));
    return c.json({ ok: true }, 202);
  });
  api.post("/runs/:id/targets/:tid/attempts", (c) => c.json(s.runs.retry(c.req.param("id"), c.req.param("tid")), 201));
  api.patch("/runs/:id", async (c) => c.json(s.runs.patch(c.req.param("id"), await body(c))));
  api.delete("/runs/:id", (c) => {
    s.runs.remove(c.req.param("id"), c.req.query("permanent") === "true");
    return c.body(null, 204);
  });
  api.post("/runs/:id/restore", (c) => {
    s.runs.restore(c.req.param("id"));
    return c.json({ ok: true });
  });
  api.get("/runs/:id/stream", (c) => {
    s.runs.row(c.req.param("id"));
    return sseResponse(c, ctx.events, runStream(c.req.param("id")));
  });

  api.post("/conversations", async (c) => c.json(await s.conversations.create(await body(c)), 201));
  api.patch("/conversations/:id", async (c) => c.json(s.conversations.patch(c.req.param("id"), await body(c))));
  api.post("/conversations/:id/messages", async (c) => c.json(s.conversations.send(c.req.param("id"), await body(c)), 201));
  api.post("/conversations/:id/cancel", (c) => {
    s.conversations.cancel(c.req.param("id"));
    return c.json({ ok: true }, 202);
  });
  api.get("/conversations/:id/stream", (c) => {
    s.conversations.view(c.req.param("id"));
    return sseResponse(c, ctx.events, convStream(c.req.param("id")));
  });

  api.post("/agent-configs", async (c) => c.json(s.agents.create((await body(c)) as never, false), 201));
  api.put("/agent-configs/:id", async (c) => c.json(s.agents.update(c.req.param("id"), (await body(c)) as never)));
  api.delete("/agent-configs/:id", (c) => {
    s.agents.remove(c.req.param("id"));
    return c.body(null, 204);
  });
  api.post("/agent-configs/:id/confirm", (c) => c.json(s.agents.confirmDraft(c.req.param("id"))));
  api.post("/agent-configs/:id/probe", async (c) => c.json(await s.agents.probe(c.req.param("id"))));
  api.post("/agent-configs/:id/purity-check", async (c) => c.json(await s.agents.purityCheck(c.req.param("id"))));
  api.post("/agent-configs/:id/thought-options", async (c) => {
    const b = thoughtOptionsRequestSchema.parse(await body(c));
    return c.json(await s.agents.thoughtOptions(c.req.param("id"), b.model_value, { refresh: b.refresh }));
  });
  api.post("/agent-configs/import-verified", (c) => {
    const { configs, errors } = buildVerifiedConfigs(ctx.sandboxHost.home);
    const created = configs.map((cfg) => s.agents.create(cfg, true));
    return c.json({ created, errors }, 201);
  });

  api.post("/thought-levels", async (c) => c.json(s.mappings.createLevel((await body(c)) as never), 201));
  api.put("/thought-levels/:id", async (c) => c.json(s.mappings.updateLevel(c.req.param("id"), (await body(c)) as never)));
  api.delete("/thought-levels/:id", (c) => {
    s.mappings.deleteLevel(c.req.param("id"));
    return c.body(null, 204);
  });

  api.get("/health", (c) => c.json({ status: "ok", ...buildInfo, node: process.version, schema_version: SCHEMA_VERSION }));

  api.all("*", () => {
    throw new AppError("not_found", "接口不存在");
  });

  app.route("/api/v1", api);
  // 所有 API 命名空间都在静态资源与 SPA 回退之前终止。
  app.all("/api", () => { throw new AppError("not_found", "接口不存在"); });
  app.all("/api/*", () => { throw new AppError("not_found", "接口不存在"); });

  const dist = ctx.config.web_dist_dir;
  if (dist === "embedded") {
    app.use("*", embeddedWeb());
  } else if (dist !== null) {
    const index = join(dist, "index.html");
    if (!existsSync(index)) throw new Error(`web_dist_dir 中没有 index.html: ${dist}，请先构建前端`);
    const html = readFileSync(index, "utf8");
    app.use("*", serveStatic({ root: dist }));
    app.get("*", (c) => {
      // 资源丢失应返回 404，避免浏览器把 HTML 当脚本或图标解析。
      if (c.req.path.startsWith("/assets/") || extname(c.req.path)) return c.notFound();
      return c.html(html);
    });
  }
  return app;
}
