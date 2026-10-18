import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { buildSandboxHost, type AppContext } from "../src/context.ts";
import { Db } from "../src/db/index.ts";
import { buildApp } from "../src/http/app.ts";
import { AgentService } from "../src/services/agents.ts";
import { ConversationService } from "../src/services/conversations.ts";
import { EventStore } from "../src/services/events.ts";
import { MappingService } from "../src/services/mappings.ts";
import { ProjectService } from "../src/services/projects.ts";
import { RunService } from "../src/services/runs.ts";
import { Scheduler } from "../src/services/scheduler.ts";
import { WorkDirs } from "../src/services/workdir.ts";

// 使用真实应用文件、SQLite 与服务实例，不替换 HTTP 或服务实现。
const root = mkdtempSync(join(tmpdir(), "llm-compare-hosting-"));
const dist = join(root, "dist");
mkdirSync(join(dist, "assets"), { recursive: true });
copyFileSync(resolve("../web/index.html"), join(dist, "index.html"));
copyFileSync(resolve("../web/public/favicon.svg"), join(dist, "favicon.svg"));
copyFileSync(resolve("../web/src/index.css"), join(dist, "assets/style.css"));
const config = { ...loadConfig(resolve("../../config.example.yaml")), data_dir: root, work_root: join(root, "work"), web_dist_dir: dist };
const db = new Db(":memory:");
const ctx: AppContext = {
  config, db, events: new EventStore(db), workdirs: new WorkDirs(config.work_root),
  sandboxHost: buildSandboxHost(config), scheduler: new Scheduler(1), stderrDir: root,
};
const agents = new AgentService(ctx);
const mappings = new MappingService(ctx);
const projects = new ProjectService(ctx);
const runs = new RunService(ctx, projects, agents, mappings);
const conversations = new ConversationService(ctx, projects, agents, mappings, runs);
const services = { agents, mappings, projects, runs, conversations };
const app = buildApp(ctx, services, crypto.randomUUID());
const request = (path: string, method = "GET") => app.request(`http://localhost${path}`, { method, headers: { host: "localhost" } });
afterAll(() => { db.raw.close(); rmSync(root, { recursive: true, force: true }); });

describe("生产前端托管", () => {
  it.each(["/", "/projects/a/runs/b", "/settings/agents/a"])("页面 %s 返回入口", async (path) => {
    const res = await request(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toBe(readFileSync(join(dist, "index.html"), "utf8"));
  });
  it.each([["/favicon.svg", "image/svg+xml"], ["/assets/style.css", "text/css"]])("资源 %s 保持正确内容与类型", async (path, mime) => {
    const res = await request(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain(mime);
    expect(await res.text()).toBe(readFileSync(join(dist, path), "utf8"));
  });
  it.each(["/api", "/api/unknown", "/api/v1/unknown", "/api/v2/projects"])("未知 API %s 返回 JSON 404", async (path) => {
    const res = await request(path);
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe("接口不存在");
  });
  it.each(["/assets/missing.js", "/missing.svg"])("缺失资源 %s 不返回入口", async (path) => {
    expect((await request(path)).status).toBe(404);
  });
  it("已有 API 仍正常工作", async () => {
    const res = await request("/api/v1/projects");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], next_cursor: null });
  });
  it("HEAD 页面无正文，非读取方法不进入 SPA", async () => {
    expect(await (await request("/projects/a", "HEAD")).text()).toBe("");
    expect((await request("/projects/a", "POST")).status).toBe(404);
  });
  it("未配置托管时只提供 API；缺失入口时启动失败", async () => {
    const apiOnly = buildApp({ ...ctx, config: { ...config, web_dist_dir: null } }, services, crypto.randomUUID());
    expect((await apiOnly.request("http://localhost/", { headers: { host: "localhost" } })).status).toBe(404);
    expect(() => buildApp({ ...ctx, config: { ...config, web_dist_dir: root } }, services, crypto.randomUUID())).toThrow("没有 index.html");
  });
});
