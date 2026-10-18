import {
  createRunSchema,
  targetName,
  runPatchSchema,
  type AttemptView,
  type CreateRunInput,
  type RunPacket,
  type RunStatus,
  type RunSummary,
  type TargetSnapshot,
  type TargetView,
} from "@llm-compare/shared";
import { AttachmentService, contentHash } from "./attachments.ts";
import { ProviderService } from "./providers.ts";
import type { AppContext } from "../context.ts";
import { newId, nowIso } from "../db/index.ts";
import { AppError, conflict, notFound } from "../errors.ts";
import { logger } from "../logger.ts";
import type { AgentService } from "./agents.ts";
import { runStream } from "./events.ts";
import { buildInput, excerpt, INPUT_BUILD_VERSION, runTitle, sha256, sliceByCodePoints } from "./input-builder.ts";
import type { MappingService } from "./mappings.ts";
import { planTargets } from "./planner.ts";
import { decodeCursor, encodeCursor, type ProjectService } from "./projects.ts";
import { attemptView, isTerminal, type AttemptRow } from "./views.ts";

export type RunRow = {
  id: string;
  project_id: string;
  run_number: number;
  source_run_id: string | null;
  title: string;
  material_version_id: string;
  prompt: string;
  build_version: string;
  submitted_text: string;
  submitted_sha256: string;
  attachment_ids: string;
  thought_level_id: string | null;
  thought_level_name: string | null;
  require_clean: number;
  library_sources: string;
  status: RunStatus;
  idempotency_key: string;
  request_sha256: string;
  created_at: string;
  deleted_at: string | null;
};
type TargetRow = { id: string; run_id: string; position: number; agent_config_id: string; snapshot_json: string };

export type RunListFilter = {
  target_id?: string;
  created_after?: string;
  created_before?: string;
  query?: string;
  include_deleted?: boolean;
};

export interface AttemptLauncher {
  launch(attemptId: string): void;
  cancel(attemptId: string): void;
}

export class RunService {
  launcher: AttemptLauncher | null = null;

  private readonly ctx: AppContext;
  private readonly projects: ProjectService;
  private readonly agents: AgentService;
  private readonly mappings: MappingService;

  constructor(ctx: AppContext, projects: ProjectService, agents: AgentService, mappings: MappingService) {
    this.ctx = ctx;
    this.projects = projects;
    this.agents = agents;
    this.mappings = mappings;
  }

  private get launch(): AttemptLauncher {
    if (!this.launcher) throw new Error("RunService 未绑定执行器");
    return this.launcher;
  }

  row(id: string): RunRow {
    const r = this.ctx.db.get<RunRow>("SELECT * FROM runs WHERE id = ?", id);
    if (!r) throw notFound("运行记录");
    return r;
  }

  async create(projectId: string, raw: unknown): Promise<{ run: RunPacket; created: boolean }> {
    const input = createRunSchema.parse(raw);
    this.projects.get(projectId);
    const { idempotency_key, ...rest } = input;
    const requestHash = sha256(JSON.stringify({ projectId, ...rest }));
    const existing = this.ctx.db.get<RunRow>("SELECT * FROM runs WHERE idempotency_key = ?", idempotency_key);
    if (existing) {
      if (existing.request_sha256 !== requestHash) throw conflict("幂等键已用于另一个不同的运行请求");
      return { run: this.packet(existing.id), created: false };
    }
    if (input.source_run_id) {
      const src = this.row(input.source_run_id);
      if (src.project_id !== projectId) throw new AppError("invalid_request", "来源运行不属于该项目", { source_run_id: "不属于该项目" });
    }
    const plan = await planTargets(input, {
      agent: (id) => this.agents.get(id),
      provider: (id, model) => new ProviderService(this.ctx).snapshot(id, model),
      modelValues: (id) => this.agents.modelOptions(id).map((m) => m.value),
      thoughtOptions: (id, model) => this.agents.thoughtOptions(id, model, { live: true }),
      level: (id) => this.mappings.level(id),
    });
    this.projects.get(projectId);
    if (input.source_run_id) this.row(input.source_run_id);
    // ACP 探测期间，另一个相同幂等请求可能已完成创建。
    const concurrent = this.ctx.db.get<RunRow>("SELECT * FROM runs WHERE idempotency_key = ?", idempotency_key);
    if (concurrent) {
      if (concurrent.request_sha256 !== requestHash) throw conflict("幂等键已用于另一个不同的运行请求");
      return { run: this.packet(concurrent.id), created: false };
    }
    const attachments = new AttachmentService(this.ctx);
    const files = attachments.list(projectId, input.attachment_ids);
    attachments.validate(plan.targets, files, (id) => this.agents.get(id).probe!.prompt_capabilities);
    const submitted = buildInput(input.material, input.prompt);
    const runId = newId();
    const attemptIds: string[] = [];
    this.ctx.db.tx(() => {
      const now = nowIso();
      const materialId = this.materialVersion(projectId, input.material, now);
      const project = this.ctx.db.get<{ next_run_number: number }>("SELECT next_run_number FROM projects WHERE id = ?", projectId)!;
      this.ctx.db.run("UPDATE projects SET next_run_number = next_run_number + 1, updated_at = ? WHERE id = ?", now, projectId);
      this.ctx.db.insert("runs", {
        id: runId,
        project_id: projectId,
        run_number: project.next_run_number,
        source_run_id: input.source_run_id,
        title: runTitle(input.prompt),
        material_version_id: materialId,
        prompt: input.prompt,
        build_version: INPUT_BUILD_VERSION,
        submitted_text: submitted,
        submitted_sha256: sha256(submitted),
        attachment_ids: JSON.stringify(input.attachment_ids),
        thought_level_id: null,
        thought_level_name: null,
        require_clean: input.require_clean ? 1 : 0,
        library_sources: JSON.stringify(input.library_sources ?? {}),
        status: "queued",
        idempotency_key,
        request_sha256: requestHash,
        created_at: now,
        deleted_at: null,
      });
      plan.targets.forEach((t, position) => {
        const targetId = newId();
        this.ctx.db.insert("run_targets", { id: targetId, run_id: runId, position, agent_config_id: t.kind === "provider" ? t.provider_id : t.agent_config_id, snapshot_json: JSON.stringify(t) });
        attemptIds.push(this.insertAttempt(runId, targetId, 1, now));
      });
    });
    logger.info({ runId, projectId, targetCount: plan.targets.length }, "创建运行");
    for (const id of attemptIds) this.launch.launch(id);
    return { run: this.packet(runId), created: true };
  }

  private materialVersion(projectId: string, content: string, now: string): string {
    const hash = sha256(content);
    const found = this.ctx.db.get<{ id: string }>("SELECT id FROM material_versions WHERE project_id = ? AND sha256 = ?", projectId, hash);
    if (found) return found.id;
    const id = newId();
    this.ctx.db.insert("material_versions", { id, project_id: projectId, content, sha256: hash, created_at: now });
    return id;
  }

  private insertAttempt(runId: string, targetId: string, seq: number, now: string): string {
    const id = newId();
    this.ctx.db.insert("attempts", {
      id, target_id: targetId, run_id: runId, seq, status: "queued", config_changed: 0, output_revision: 0, t_created: now,
    });
    return id;
  }

  targets(runId: string): TargetView[] {
    const targets = this.ctx.db.all<TargetRow>("SELECT * FROM run_targets WHERE run_id = ? ORDER BY position", runId);
    const attempts = this.ctx.db.all<AttemptRow>("SELECT * FROM attempts WHERE run_id = ? ORDER BY seq", runId);
    const legacy = this.row(runId);
    // v1–v3 将档位存于轮次；仅在旧快照缺少对象档位时继承，不改写原始记录。
    const readSnapshot = (json: string): TargetSnapshot => {
      const snapshot = JSON.parse(json) as TargetSnapshot;
      return Object.hasOwn(snapshot, "thought_level_id") ? snapshot : { ...snapshot, thought_level_id: legacy.thought_level_id, thought_level_name: legacy.thought_level_name };
    };
    return targets.map((t) => ({
      id: t.id,
      position: t.position,
      snapshot: readSnapshot(t.snapshot_json),
      attempts: attempts.filter((a) => a.target_id === t.id).map((a) => attemptView(a, this.ctx.events)),
    }));
  }

  packet(runId: string): RunPacket {
    const r = this.row(runId);
    const material = this.ctx.db.get<{ content: string; sha256: string }>("SELECT content, sha256 FROM material_versions WHERE id = ?", r.material_version_id)!;
    const targets = this.targets(runId);
    const files = new AttachmentService(this.ctx).list(r.project_id, JSON.parse(r.attachment_ids));
    return {
      schema_version: 6,
      id: r.id,
      project_id: r.project_id,
      source_run_id: r.source_run_id,
      run_number: r.run_number,
      title: r.title,
      created_at: r.created_at,
      target_count: targets.length,
      status: r.status,
      deleted: r.deleted_at !== null,
      input: {
        material: material.content,
        attachments: files,
        library_sources: JSON.parse(r.library_sources),
        content_sha256: contentHash(r.submitted_text, files),
        material_sha256: material.sha256,
        prompt: r.prompt,
        build_version: r.build_version,
        submitted_text: r.submitted_text,
        submitted_sha256: r.submitted_sha256,
      },
      comparison: {
        require_clean: r.require_clean === 1,
      },
      targets,
      execution_context: {
        events_url: `/api/v1/runs/${r.id}/events`,
        note: "执行事件（工具调用、思考片段、计划、权限请求、用量与配置变更）由各 Agent 实际发送的内容决定；某类事件不存在不代表 Agent 未执行相应行为。",
      },
      snapshot: { read_at: nowIso(), event_revision: this.ctx.events.lastSeq(runStream(r.id)) },
    };
  }

  attempt(runId: string, attemptId: string): AttemptView {
    const a = this.ctx.db.get<AttemptRow>("SELECT * FROM attempts WHERE id = ? AND run_id = ?", attemptId, runId);
    if (!a) throw notFound("尝试");
    return attemptView(a, this.ctx.events);
  }

  content(runId: string, attemptId: string, q: { revision?: number; offset: number; limit: number }) {
    const view = this.attempt(runId, attemptId);
    const revision = q.revision ?? view.output_revision;
    if (revision > view.output_revision) {
      throw new AppError("invalid_request", `revision ${revision} 超出该尝试已保存的事件序号 ${view.output_revision}`, { revision: "超出范围" });
    }
    const text = revision === view.output_revision ? view.output_text : this.ctx.events.attemptOutput(attemptId, revision);
    const page = sliceByCodePoints(text, q.offset, q.limit);
    return {
      attempt_id: attemptId,
      revision,
      offset: q.offset,
      total_length: page.total_length,
      next_offset: page.next_offset,
      complete: view.output_complete && revision === view.output_revision,
      text: page.text,
    };
  }

  list(projectId: string, f: RunListFilter, limit: number, cursor: string | undefined): { items: RunSummary[]; next_cursor: string | null } {
    this.projects.get(projectId);
    const where = ["r.project_id = ?"];
    const params: (string | number)[] = [projectId];
    if (!f.include_deleted) where.push("r.deleted_at IS NULL");
    if (f.target_id) (where.push("EXISTS (SELECT 1 FROM run_targets t WHERE t.run_id = r.id AND t.agent_config_id = ?)"), params.push(f.target_id));
    if (f.created_after) (where.push("r.created_at >= ?"), params.push(new Date(f.created_after).toISOString()));
    if (f.created_before) (where.push("r.created_at < ?"), params.push(new Date(f.created_before).toISOString()));
    if (f.query) (where.push("(r.title LIKE ? OR r.prompt LIKE ?)"), params.push(`%${f.query}%`, `%${f.query}%`));
    if (cursor) {
      const [created, id] = decodeCursor(cursor);
      if (!created || !id) throw new AppError("invalid_request", "cursor 无效", { cursor: "无法解析" });
      where.push("(r.created_at < ? OR (r.created_at = ? AND r.id < ?))");
      params.push(created!, created!, id!);
    }
    const rows = this.ctx.db.all<RunRow>(`SELECT r.* FROM runs r WHERE ${where.join(" AND ")} ORDER BY r.created_at DESC, r.id DESC LIMIT ?`, ...params, limit + 1);
    const items = rows.slice(0, limit).map((r) => this.summary(r));
    const last = rows.length > limit ? rows[limit - 1]! : null;
    return { items, next_cursor: last ? encodeCursor(last.created_at, last.id) : null };
  }

  summary(r: RunRow): RunSummary {
    const material = this.ctx.db.get<{ content: string }>("SELECT content FROM material_versions WHERE id = ?", r.material_version_id)!;
    const targets = this.targets(r.id);
    const latest = targets.map((t) => t.attempts[t.attempts.length - 1]!);
    const source = r.source_run_id ? this.ctx.db.get<{ run_number: number }>("SELECT run_number FROM runs WHERE id = ?", r.source_run_id) : undefined;
    return {
      id: r.id,
      project_id: r.project_id,
      source_run_id: r.source_run_id,
      source_run_number: source?.run_number ?? null,
      run_number: r.run_number,
      title: r.title,
      target_count: targets.length,
      status: r.status,
      prompt_excerpt: excerpt(r.prompt, 2, 200),
      material_excerpt: material.content.length > 0 ? excerpt(material.content, 1, 120) : null,
      targets: targets.map((t) => ({ label: targetName(t.snapshot), model: t.snapshot.base_model, thought_level_name: t.snapshot.thought_level_name })),
      completion: { succeeded: latest.filter((a) => a.status === "succeeded").length, total: latest.length },
      created_at: r.created_at,
      deleted: r.deleted_at !== null,
    };
  }

  patch(runId: string, raw: unknown): RunSummary {
    const v = runPatchSchema.parse(raw);
    this.row(runId);
    this.ctx.db.update("runs", runId, { title: v.title });
    return this.summary(this.row(runId));
  }

  cancelRun(runId: string): void {
    this.row(runId);
    for (const t of this.targets(runId)) {
      const latest = t.attempts[t.attempts.length - 1]!;
      if (!isTerminal(latest.status)) this.launch.cancel(latest.id);
    }
  }

  cancelAttempt(runId: string, attemptId: string): void {
    const a = this.attempt(runId, attemptId);
    if (isTerminal(a.status)) throw conflict("该尝试已经结束");
    this.launch.cancel(attemptId);
  }

  retry(runId: string, targetId: string): AttemptView {
    const r = this.row(runId);
    if (r.deleted_at) throw conflict("运行记录已在回收站中，不能重试");
    const target = this.targets(runId).find((t) => t.id === targetId);
    if (!target) throw notFound("对比对象");
    const latest = target.attempts[target.attempts.length - 1]!;
    if (!isTerminal(latest.status)) throw conflict("该对象的最新尝试仍在执行，结束后才能重试");
    const id = this.ctx.db.tx(() => {
      const attemptId = this.insertAttempt(runId, targetId, latest.seq + 1, nowIso());
      this.ctx.db.update("runs", runId, { status: "queued" });
      return attemptId;
    });
    logger.info({ runId, targetId, attemptId: id, seq: latest.seq + 1 }, "显式重试");
    this.ctx.events.append(runStream(runId), "run_update", {}, this.summary(this.row(runId)));
    this.launch.launch(id);
    return this.attempt(runId, id);
  }

  remove(runId: string, permanent: boolean): void {
    const r = this.row(runId);
    if (!permanent) {
      if (r.deleted_at) throw conflict("运行记录已在回收站中");
      this.ctx.db.update("runs", runId, { deleted_at: nowIso() });
      return;
    }
    const running = this.targets(runId).flatMap((t) => t.attempts).some((a) => !isTerminal(a.status));
    if (running) throw conflict("运行仍在执行，结束后才能永久删除");
    if (this.ctx.db.get("SELECT 1 FROM runs WHERE source_run_id = ?", runId)) {
      this.ctx.db.run("UPDATE runs SET source_run_id = NULL WHERE source_run_id = ?", runId);
    }
    this.ctx.db.tx(() => {
      this.ctx.events.deleteStream(runStream(runId));
      this.ctx.db.run("DELETE FROM attempts WHERE run_id = ?", runId);
      this.ctx.db.run("DELETE FROM run_targets WHERE run_id = ?", runId);
      this.ctx.db.run("DELETE FROM runs WHERE id = ?", runId);
      const stillUsed = this.ctx.db.get("SELECT 1 FROM runs WHERE material_version_id = ?", r.material_version_id);
      if (!stillUsed) this.ctx.db.run("DELETE FROM material_versions WHERE id = ?", r.material_version_id);
    });
    logger.info({ runId }, "永久删除运行");
  }

  restore(runId: string): void {
    const r = this.row(runId);
    if (!r.deleted_at) throw conflict("运行记录不在回收站中");
    this.ctx.db.update("runs", runId, { deleted_at: null });
  }

  recomputeStatus(runId: string): RunStatus {
    const latest = this.targets(runId).map((t) => t.attempts[t.attempts.length - 1]!.status);
    let status: RunStatus;
    if (latest.some((s) => s === "running" || s === "cancel_requested")) status = "running";
    else if (latest.some((s) => s === "queued")) status = "queued";
    else if (latest.every((s) => s === "succeeded")) status = "succeeded";
    else if (latest.every((s) => s === "cancelled")) status = "cancelled";
    else if (latest.some((s) => s === "succeeded")) status = "partial";
    else status = "failed";
    this.ctx.db.update("runs", runId, { status });
    return status;
  }
}

export type { CreateRunInput };
