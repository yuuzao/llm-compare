import { writeFileSync } from "node:fs";
import { AttachmentService } from "./attachments.ts";
import { join } from "node:path";
import {
  targetName,
  conversationCreateSchema,
  conversationPatchSchema,
  messageCreateSchema,
  type ConversationView,
  type MessageSource,
  type MessageView,
  type SendMessageResult,
  type AgentTargetSnapshot,
  type TimingView,
  type UsageView,
} from "@llm-compare/shared";
import { buildSandboxArgv } from "../acp/sandbox.ts";
import { AcpTurn } from "../acp/turn.ts";
import type { AppContext } from "../context.ts";
import { newId, nowIso } from "../db/index.ts";
import { AppError, conflict, notFound } from "../errors.ts";
import { logger } from "../logger.ts";
import type { AgentService } from "./agents.ts";
import { convStream } from "./events.ts";
import type { MappingService } from "./mappings.ts";
import { planTargets } from "./planner.ts";
import type { ProjectService } from "./projects.ts";
import type { RunService } from "./runs.ts";
import { buildSnapshotFiles, buildAnalysisPrompt } from "./analysis-snapshot.ts";
import { timingColumns, usageColumns } from "./usage.ts";
import { compareFingerprints, fingerprintDir } from "./workdir.ts";
import { isTerminal } from "./views.ts";

type ConvRow = { id: string; project_id: string; agent_config_id: string; snapshot_json: string; scope_json: string; created_at: string; updated_at: string };
type ConvSnapshot = { target: AgentTargetSnapshot; thought_level_name: string | null };
type MsgRow = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  status: MessageView["status"];
  sources_json: string;
  error: string | null;
  readonly_check: MessageView["readonly_check"];
  timing_json: string | null;
  usage_json: string | null;
  created_at: string;
};

export class ConversationService {
  private readonly active = new Map<string, AcpTurn>();

  private readonly ctx: AppContext;
  private readonly projects: ProjectService;
  private readonly agents: AgentService;
  private readonly mappings: MappingService;
  private readonly runs: RunService;

  constructor(ctx: AppContext, projects: ProjectService, agents: AgentService, mappings: MappingService, runs: RunService) {
    this.ctx = ctx;
    this.projects = projects;
    this.agents = agents;
    this.mappings = mappings;
    this.runs = runs;
  }

  private row(id: string): ConvRow {
    const r = this.ctx.db.get<ConvRow>("SELECT * FROM conversations WHERE id = ? AND deleted_at IS NULL", id);
    if (!r) throw notFound("分析会话");
    return r;
  }

  private checkScope(projectId: string, runIds: string[]): void {
    for (const id of runIds) {
      const r = this.runs.row(id);
      if (r.project_id !== projectId) throw new AppError("invalid_request", "关联的运行不属于该项目", { scope: id });
    }
  }

  view(id: string): ConversationView {
    const r = this.row(id);
    const snap = JSON.parse(r.snapshot_json) as ConvSnapshot;
    const scope = JSON.parse(r.scope_json) as { run_ids: string[] };
    const runs = scope.run_ids.flatMap((rid) => {
      const run = this.ctx.db.get<{ id: string; run_number: number; title: string }>("SELECT id, run_number, title FROM runs WHERE id = ?", rid);
      return run ? [run] : [];
    });
    return {
      id: r.id,
      project_id: r.project_id,
      agent_config_id: r.agent_config_id,
      agent_config_name: snap.target.agent_config_name,
      model: snap.target.base_model,
      thought_level_name: snap.thought_level_name,
      scope: { run_ids: scope.run_ids, runs },
      generating: this.ctx.db.get("SELECT 1 FROM messages WHERE conversation_id = ? AND status = 'generating'", id) !== undefined,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }

  list(projectId: string): ConversationView[] {
    this.projects.get(projectId);
    return this.ctx.db
      .all<{ id: string }>("SELECT id FROM conversations WHERE project_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC", projectId)
      .map((r) => this.view(r.id));
  }

  async create(raw: unknown): Promise<ConversationView> {
    const v = conversationCreateSchema.parse(raw);
    this.projects.get(v.project_id);
    this.checkScope(v.project_id, v.scope.run_ids);
    const plan = await planTargets(
      { targets: [{ agent_config_id: v.agent_config_id, model: v.model, thought_value: v.thought_value, model_parameters: v.model_parameters }], require_clean: false },
      {
        agent: (id) => this.agents.get(id),
        modelValues: (id) => this.agents.modelOptions(id).map((m) => m.value),
        thoughtOptions: (id, model) => this.agents.thoughtOptions(id, model, { live: true }),
        level: (id) => this.mappings.level(id),
      },
    );
    this.projects.get(v.project_id);
    this.checkScope(v.project_id, v.scope.run_ids);
    const id = newId();
    const now = nowIso();
    const snapshot: ConvSnapshot = { target: plan.targets[0]! as AgentTargetSnapshot, thought_level_name: plan.targets[0]!.thought_level_name };
    this.ctx.db.insert("conversations", {
      id, project_id: v.project_id, agent_config_id: v.agent_config_id, snapshot_json: JSON.stringify(snapshot), scope_json: JSON.stringify(v.scope), created_at: now, updated_at: now, deleted_at: null,
    });
    logger.info({ conversationId: id, agent: snapshot.target.agent_config_name }, "创建分析会话（未发送提示词）");
    return this.view(id);
  }

  patch(id: string, raw: unknown): ConversationView {
    const r = this.row(id);
    const v = conversationPatchSchema.parse(raw);
    this.checkScope(r.project_id, v.scope.run_ids);
    this.ctx.db.update("conversations", id, { scope_json: JSON.stringify(v.scope), updated_at: nowIso() });
    return this.view(id);
  }

  messages(id: string, limit: number, cursor: string | undefined): { items: MessageView[]; next_cursor: string | null } {
    this.row(id);
    const after = cursor ?? "";
    const rows = this.ctx.db.all<MsgRow>("SELECT * FROM messages WHERE conversation_id = ? AND created_at || id > ? ORDER BY created_at, id LIMIT ?", id, after, limit + 1);
    const items = rows.slice(0, limit).map((m) => this.messageView(m));
    const last = rows.length > limit ? rows[limit - 1]! : null;
    return { items, next_cursor: last ? last.created_at + last.id : null };
  }

  private messageView(m: MsgRow): MessageView {
    const sources = (JSON.parse(m.sources_json) as Omit<MessageSource, "source_deleted">[]).map((s) => ({
      ...s,
      source_deleted: this.ctx.db.get("SELECT 1 FROM attempts WHERE id = ?", s.attempt_id) === undefined,
    }));
    const content =
      m.status === "generating"
        ? this.ctx.db
            .all<{ payload_json: string }>("SELECT payload_json FROM events WHERE message_id = ? AND type = 'output_chunk' ORDER BY seq", m.id)
            .map((e) => (JSON.parse(e.payload_json) as { text: string }).text)
            .join("")
        : m.content;
    return {
      id: m.id,
      conversation_id: m.conversation_id,
      role: m.role,
      content,
      status: m.status,
      sources,
      error: m.error,
      readonly_check: m.readonly_check,
      timing: m.timing_json ? (JSON.parse(m.timing_json) as TimingView) : null,
      usage: m.usage_json ? (JSON.parse(m.usage_json) as UsageView) : null,
      created_at: m.created_at,
    };
  }

  private collectSources(runIds: string[]): MessageSource[] {
    const out: MessageSource[] = [];
    for (const runId of runIds) {
      const run = this.ctx.db.get<{ run_number: number }>("SELECT run_number FROM runs WHERE id = ?", runId);
      if (!run) continue;
      for (const t of this.runs.targets(runId)) {
        const chosen = [...t.attempts].reverse().find((a) => isTerminal(a.status)) ?? t.attempts[t.attempts.length - 1]!;
        out.push({
          run_id: runId,
          run_number: run.run_number,
          attempt_id: chosen.id,
          target_label: `${targetName(t.snapshot)}${t.snapshot.base_model ? ` / ${t.snapshot.base_model}` : ""}`,
          attempt_seq: chosen.seq,
          revision: chosen.output_revision,
          complete: chosen.output_complete && chosen.status === "succeeded",
          status: chosen.status,
          source_deleted: false,
        });
      }
    }
    return out;
  }

  send(id: string, raw: unknown): SendMessageResult {
    const conv = this.row(id);
    const v = messageCreateSchema.parse(raw);
    if (this.view(id).generating) throw conflict("该会话已有正在生成的回复，请等待完成或先停止");
    const scope = JSON.parse(conv.scope_json) as { run_ids: string[] };
    const sources = this.collectSources(scope.run_ids);
    if (sources.length === 0) throw new AppError("invalid_request", "关联范围内没有可用的运行记录");
    const history = this.ctx.db.all<MsgRow>("SELECT * FROM messages WHERE conversation_id = ? AND status = 'succeeded' ORDER BY created_at, id", id);
    const userId = newId();
    const assistantId = newId();
    const files = buildSnapshotFiles(sources, (runId) => this.runs.packet(runId), (s) => this.runs.content(s.run_id, s.attempt_id, { revision: s.revision, offset: 0, limit: Number.MAX_SAFE_INTEGER }).text);
    const snapshotDir = this.ctx.workdirs.writeSnapshot(assistantId, files);
    const attachmentService = new AttachmentService(this.ctx);
    const attachmentNames: string[] = [];
    for (const runId of scope.run_ids) for (const file of this.runs.packet(runId).input.attachments) {
      const name = `attachment-${file.id}${file.kind === "pdf" ? ".pdf" : file.kind === "text" ? ".txt" : "." + file.mime_type.split("/")[1]}`;
      writeFileSync(join(snapshotDir, name), attachmentService.data(file));
      attachmentNames.push(name);
    }
    const prompt = buildAnalysisPrompt([...Object.keys(files), ...attachmentNames], history.map((h) => ({ role: h.role, content: h.content })), v.content);
    const t0 = nowIso();
    this.ctx.db.tx(() => {
      this.ctx.db.insert("messages", { id: userId, conversation_id: id, role: "user", content: v.content, status: "succeeded", sources_json: JSON.stringify(sources), snapshot_dir: null, readonly_check: null, error: null, timing_json: null, usage_json: null, created_at: t0 });
      this.ctx.db.insert("messages", { id: assistantId, conversation_id: id, role: "assistant", content: "", status: "generating", sources_json: JSON.stringify(sources), snapshot_dir: snapshotDir, readonly_check: null, error: null, timing_json: null, usage_json: null, created_at: nowIso() });
      this.ctx.db.update("conversations", id, { updated_at: nowIso() });
    });
    const snap = JSON.parse(conv.snapshot_json) as ConvSnapshot;
    this.ctx.scheduler.enqueue(`message:${assistantId}`, () => this.execute(id, assistantId, snap.target, snapshotDir, prompt));
    this.publish(id, assistantId);
    return { user: this.message(userId), assistant: this.message(assistantId) };
  }

  private message(id: string): MessageView {
    const m = this.ctx.db.get<MsgRow>("SELECT * FROM messages WHERE id = ?", id);
    if (!m) throw notFound("消息");
    return this.messageView(m);
  }

  private publish(conversationId: string, messageId: string): void {
    this.ctx.events.append(convStream(conversationId), "message_update", { message_id: messageId }, this.message(messageId));
  }

  cancel(id: string): void {
    this.row(id);
    const gen = this.ctx.db.get<{ id: string }>("SELECT id FROM messages WHERE conversation_id = ? AND status = 'generating'", id);
    if (!gen) throw conflict("该会话没有正在生成的回复");
    if (this.ctx.scheduler.remove(`message:${gen.id}`)) {
      this.ctx.db.update("messages", gen.id, { status: "cancelled", error: "在排队阶段被取消" });
      this.publish(id, gen.id);
      return;
    }
    const turn = this.active.get(gen.id);
    if (!turn) throw conflict("回复已结束");
    turn.cancel();
  }

  private async execute(conversationId: string, messageId: string, target: AgentTargetSnapshot, cwd: string, prompt: string): Promise<void> {
    const log = logger.child({ conversationId, messageId, agent: target.agent_config_name });
    const created = nowIso();
    let argv: string[];
    try {
      argv = buildSandboxArgv(this.ctx.sandboxHost, { config: target.config, cwd });
    } catch (err) {
      this.ctx.db.update("messages", messageId, { status: "failed", error: `无法构建沙箱：${(err as Error).message}` });
      this.publish(conversationId, messageId);
      return;
    }
    const before = fingerprintDir(cwd);
    const turn = new AcpTurn({
      argv,
      sessionCwd: cwd,
      settings: target.settings.map((s) => ({ kind: s.kind, configId: s.config_id, value: s.value })),
      parameterizedModelPicker: target.config.thought_mode !== "in_model",
      promptText: prompt,
      startupTimeoutMs: this.ctx.config.timeouts.startup_ms,
      promptTimeoutMs: this.ctx.config.timeouts.attempt_ms,
      cancelConfirmMs: this.ctx.config.timeouts.cancel_confirm_ms,
      maxOutputChars: this.ctx.config.limits.max_output_chars,
      stderrPath: join(this.ctx.stderrDir, `message-${messageId}.log`),
      onEvent: (e) => {
        const { type, ...payload } = e;
        this.ctx.events.append(convStream(conversationId), type, { message_id: messageId }, payload);
      },
      log,
    });
    this.active.set(messageId, turn);
    const r = await turn.run();
    this.active.delete(messageId);
    const diffText = compareFingerprints(before, fingerprintDir(cwd));
    const timing = timingColumns(r, created);
    const usage = usageColumns(r.promptUsage, r.lastUsageUpdate);
    this.ctx.db.update("messages", messageId, {
      content: r.outputText,
      status: r.outcome,
      error: diffText ? `${r.error ?? ""}${r.error ? "；" : ""}只读检查未通过：${diffText}` : r.error,
      readonly_check: diffText === null ? "passed" : "failed",
      timing_json: JSON.stringify({
        queue_ms: timing.queue_ms, startup_ms: timing.startup_ms, ttft_ms: timing.ttft_ms, generation_ms: timing.generation_ms, total_ms: timing.total_ms, started_at: timing.t_spawn, ended_at: timing.t_end,
      }),
      usage_json: JSON.stringify({
        ...Object.fromEntries(["input_tokens", "output_tokens", "total_tokens", "thought_tokens", "cached_read_tokens", "cached_write_tokens", "context_used", "context_size", "cost_amount", "cost_currency"].map((k) => [k, usage[k] ?? null])),
        prompt_usage_reported: usage.prompt_usage_json !== null,
        usage_update_reported: usage.usage_update_json !== null,
      }),
    });
    log.info({ status: r.outcome, error: r.error }, "分析回复结束");
    this.publish(conversationId, messageId);
  }
}

export function recoverMessages(ctx: AppContext): void {
  const rows = ctx.db.all<{ id: string }>("SELECT id FROM messages WHERE status = 'generating'");
  for (const m of rows) {
    const text = ctx.db
      .all<{ payload_json: string }>("SELECT payload_json FROM events WHERE message_id = ? AND type = 'output_chunk' ORDER BY seq", m.id)
      .map((e) => (JSON.parse(e.payload_json) as { text: string }).text)
      .join("");
    ctx.db.update("messages", m.id, { status: "interrupted", content: text, error: "后端重启时该回复尚未生成完毕，已保留重启前保存的内容" });
  }
  if (rows.length) logger.warn({ messages: rows.length }, "已将重启前未完成的分析回复标记为中断");
}
