import { ProviderTurn } from "../provider/turn.ts";
import { ProviderService } from "./providers.ts";
import { AttachmentService } from "./attachments.ts";
import { join } from "node:path";
import { targetName, type AttemptStatus, type TargetSnapshot } from "@llm-compare/shared";
import { buildSandboxArgv } from "../acp/sandbox.ts";
import { AcpTurn, type TurnEvent } from "../acp/turn.ts";
import type { AppContext } from "../context.ts";
import { nowIso } from "../db/index.ts";
import { logger } from "../logger.ts";
import type { AgentService } from "./agents.ts";
import { runStream } from "./events.ts";
import type { AttemptLauncher, RunService } from "./runs.ts";
import { timingColumns, usageColumns, usageReportKind } from "./usage.ts";
import { compareFingerprints, fingerprintDir } from "./workdir.ts";
import type { AttemptRow } from "./views.ts";

export class AttemptExecutor implements AttemptLauncher {
  private readonly active = new Map<string, AcpTurn | ProviderTurn>();

  private readonly ctx: AppContext;
  private readonly runs: RunService;
  private readonly agents: AgentService;

  constructor(ctx: AppContext, runs: RunService, agents: AgentService) {
    this.ctx = ctx;
    this.runs = runs;
    this.agents = agents;
  }

  launch(attemptId: string): void {
    this.ctx.scheduler.enqueue(`attempt:${attemptId}`, async () => {
      try { await this.execute(attemptId); }
      catch (error) {
        const row = this.row(attemptId);
        this.ctx.db.update("attempts", attemptId, { status: "failed", error: error instanceof Error ? error.message : String(error), output_text: this.ctx.events.attemptOutput(attemptId, Number.MAX_SAFE_INTEGER), output_revision: this.ctx.events.maxAttemptSeq(attemptId), t_end: nowIso() });
        this.active.delete(attemptId);
        this.publish(row);
      }
    });
  }

  cancel(attemptId: string): void {
    const row = this.row(attemptId);
    if (row.status === "queued" && this.ctx.scheduler.remove(`attempt:${attemptId}`)) {
      this.finishWithoutRun(row, "cancelled", "在排队阶段被取消");
      return;
    }
    const turn = this.active.get(attemptId);
    if (!turn) {
      logger.warn({ attemptId, status: row.status }, "取消请求找不到正在执行的尝试");
      return;
    }
    this.setStatus(row, "cancel_requested");
    turn.cancel();
  }

  private row(id: string): AttemptRow {
    const r = this.ctx.db.get<AttemptRow>("SELECT * FROM attempts WHERE id = ?", id);
    if (!r) throw new Error(`尝试 ${id} 不存在`);
    return r;
  }

  private publish(row: AttemptRow): void {
    const fresh = this.row(row.id);
    this.ctx.events.append(runStream(row.run_id), "attempt_update", { attempt_id: row.id }, this.runs.attempt(row.run_id, fresh.id));
    this.runs.recomputeStatus(row.run_id);
    this.ctx.events.append(runStream(row.run_id), "run_update", {}, this.runs.summary(this.runs.row(row.run_id)));
  }

  private setStatus(row: AttemptRow, status: AttemptStatus): void {
    this.ctx.db.update("attempts", row.id, { status });
    this.publish(row);
  }

  private finishWithoutRun(row: AttemptRow, status: AttemptStatus, error: string): void {
    this.ctx.db.update("attempts", row.id, { status, error, output_text: "", output_revision: 0, t_end: nowIso() });
    logger.info({ attemptId: row.id, status, error }, "尝试未执行即结束");
    this.publish(row);
  }

  private async execute(attemptId: string): Promise<void> {
    const row = this.row(attemptId);
    if (row.status !== "queued") {
      logger.warn({ attemptId, status: row.status }, "尝试出队时已不是排队状态，跳过");
      return;
    }
    const target = this.ctx.db.get<{ snapshot_json: string }>("SELECT snapshot_json FROM run_targets WHERE id = ?", row.target_id)!;
    const snapshot = JSON.parse(target.snapshot_json) as TargetSnapshot;
    const submitted = this.ctx.db.get<{ submitted_text: string }>("SELECT submitted_text FROM runs WHERE id = ?", row.run_id)!.submitted_text;
    const log = logger.child({ runId: row.run_id, attemptId, target: targetName(snapshot), model: snapshot.model_value });
    const cwd = this.ctx.workdirs.attemptDir(attemptId);
    this.ctx.db.update("attempts", attemptId, { status: "running", cwd });
    this.publish(row);

    const attachments = new AttachmentService(this.ctx);
    const packet = this.runs.packet(row.run_id);
    const files = packet.input.attachments;
    if (snapshot.kind === "provider") {
      try {
        const turn = new ProviderTurn({ log, snapshot, apiKey: new ProviderService(this.ctx).secret(snapshot.credential_ref), text: submitted, files, attachments,
          timeoutMs: this.ctx.config.timeouts.attempt_ms, maxChars: this.ctx.config.limits.max_output_chars,
          onEvent: ({ type, ...payload }) => { this.ctx.events.append(runStream(row.run_id), type, { attempt_id: attemptId }, payload); },
        });
        this.active.set(attemptId, turn);
        const r = await turn.run();
        this.ctx.db.update("attempts", attemptId, { status: r.outcome, readback_model: r.readbacks.model ?? null, stop_reason: r.stopReason,
          output_text: r.outputText, output_revision: this.ctx.events.maxAttemptSeq(attemptId), error: r.error, ...timingColumns(r, row.t_created), ...usageColumns(r.promptUsage, null) });
        this.publish(row);
      } catch (error) { this.finishWithoutRun(row, "failed", error instanceof Error ? error.message : String(error)); }
      finally { this.active.delete(attemptId); }
      return;
    }
    let argv: string[];
    try {
      argv = buildSandboxArgv(this.ctx.sandboxHost, { config: snapshot.config, cwd });
    } catch (err) {
      this.finishWithoutRun(row, "failed", `无法构建沙箱：${(err as Error).message}`);
      return;
    }
    const before = fingerprintDir(cwd);
    const stream = runStream(row.run_id);
    const turn = new AcpTurn({
      argv,
      sessionCwd: cwd,
      settings: snapshot.settings.map((s) => ({ kind: s.kind, configId: s.config_id, value: s.value })),
      parameterizedModelPicker: snapshot.config.thought_mode !== "in_model",
      promptText: submitted,
      promptAttachments: attachments.acp(files),
      startupTimeoutMs: this.ctx.config.timeouts.startup_ms,
      promptTimeoutMs: this.ctx.config.timeouts.attempt_ms,
      cancelConfirmMs: this.ctx.config.timeouts.cancel_confirm_ms,
      maxOutputChars: this.ctx.config.limits.max_output_chars,
      stderrPath: join(this.ctx.stderrDir, `attempt-${attemptId}.log`),
      onEvent: (e: TurnEvent) => {
        const { type, ...payload } = e;
        this.ctx.events.append(stream, type, { attempt_id: attemptId }, payload);
      },
      log,
    });
    this.active.set(attemptId, turn);
    log.info({ settings: snapshot.settings }, "开始执行尝试");
    const r = await turn.run();
    this.active.delete(attemptId);

    const diffText = compareFingerprints(before, fingerprintDir(cwd));
    const status: AttemptStatus = r.outcome;
    this.ctx.db.update("attempts", attemptId, {
      status,
      acp_session_id: r.sessionId,
      agent_name: r.agentInfo?.name ?? null,
      agent_version: r.agentInfo?.version ?? null,
      readback_model: r.readbacks.model ?? null,
      readback_thought: r.readbacks.thought ?? null,
      readback_readonly: r.readbacks.readonly ?? null,
      stop_reason: r.stopReason,
      readonly_check: diffText === null ? "passed" : "failed",
      readonly_check_detail: diffText,
      config_changed: r.configChanged ? 1 : 0,
      output_text: r.outputText,
      output_revision: this.ctx.events.maxAttemptSeq(attemptId),
      error: r.error,
      ...timingColumns(r, row.t_created),
      ...usageColumns(r.promptUsage, r.lastUsageUpdate),
    });
    if (r.t.prompt !== null && r.outcome === "succeeded") {
      this.agents.recordUsageReport(snapshot.agent_config_id, usageReportKind(r.promptUsage, r.lastUsageUpdate));
    }
    if (diffText !== null) log.error({ diff: diffText }, "只读检查未通过");
    log.info({ status, stopReason: r.stopReason, error: r.error, chars: r.outputText.length }, "尝试结束");
    this.publish(row);
  }
}

export function recoverInterrupted(ctx: AppContext, runs: RunService): void {
  const stale = ctx.db.all<{ id: string; run_id: string }>("SELECT id, run_id FROM attempts WHERE status IN ('queued', 'running', 'cancel_requested')");
  for (const a of stale) {
    const text = ctx.events.attemptOutput(a.id, Number.MAX_SAFE_INTEGER);
    ctx.db.update("attempts", a.id, {
      status: "interrupted",
      error: "后端重启时该尝试尚未结束，已保留重启前保存的输出",
      output_text: text,
      output_revision: ctx.events.maxAttemptSeq(a.id),
    });
  }
  for (const runId of new Set(stale.map((a) => a.run_id))) runs.recomputeStatus(runId);
  if (stale.length) logger.warn({ attempts: stale.length }, "已将重启前未结束的尝试标记为中断");
}
