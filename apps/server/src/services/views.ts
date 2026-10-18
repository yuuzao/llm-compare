import type { AttemptStatus, AttemptView, TimingView, UsageView } from "@llm-compare/shared";
import type { EventStore } from "./events.ts";

export type AttemptRow = {
  id: string;
  target_id: string;
  run_id: string;
  seq: number;
  status: AttemptStatus;
  acp_session_id: string | null;
  agent_name: string | null;
  agent_version: string | null;
  readback_model: string | null;
  readback_thought: string | null;
  readback_readonly: string | null;
  stop_reason: string | null;
  readonly_check: "passed" | "failed" | null;
  readonly_check_detail: string | null;
  config_changed: number;
  cwd: string | null;
  output_text: string | null;
  output_revision: number;
  t_created: string;
  t_spawn: string | null;
  t_end: string | null;
  queue_ms: number | null;
  startup_ms: number | null;
  ttft_ms: number | null;
  generation_ms: number | null;
  total_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  thought_tokens: number | null;
  cached_read_tokens: number | null;
  cached_write_tokens: number | null;
  prompt_usage_json: string | null;
  context_used: number | null;
  context_size: number | null;
  cost_amount: number | null;
  cost_currency: string | null;
  usage_update_json: string | null;
  error: string | null;
};

export const TERMINAL: ReadonlySet<AttemptStatus> = new Set(["succeeded", "failed", "cancelled", "interrupted"]);
export const isTerminal = (s: AttemptStatus): boolean => TERMINAL.has(s);

export function attemptView(r: AttemptRow, events: EventStore): AttemptView {
  const terminal = isTerminal(r.status);
  const revision = terminal ? r.output_revision : events.maxAttemptSeq(r.id);
  const text = terminal ? (r.output_text ?? "") : events.attemptOutput(r.id, revision);
  const timing: TimingView = {
    queue_ms: r.queue_ms,
    startup_ms: r.startup_ms,
    ttft_ms: r.ttft_ms,
    generation_ms: r.generation_ms,
    total_ms: r.total_ms,
    started_at: r.t_spawn,
    ended_at: r.t_end,
  };
  const usage: UsageView = {
    input_tokens: r.input_tokens,
    output_tokens: r.output_tokens,
    total_tokens: r.total_tokens,
    thought_tokens: r.thought_tokens,
    cached_read_tokens: r.cached_read_tokens,
    cached_write_tokens: r.cached_write_tokens,
    context_used: r.context_used,
    context_size: r.context_size,
    cost_amount: r.cost_amount,
    cost_currency: r.cost_currency,
    prompt_usage_reported: r.prompt_usage_json !== null,
    usage_update_reported: r.usage_update_json !== null,
  };
  return {
    id: r.id,
    target_id: r.target_id,
    seq: r.seq,
    status: r.status,
    agent_name: r.agent_name,
    agent_version: r.agent_version,
    readback_model: r.readback_model,
    readback_thought: r.readback_thought,
    readback_readonly: r.readback_readonly,
    stop_reason: r.stop_reason,
    readonly_check: r.readonly_check,
    readonly_check_detail: r.readonly_check_detail,
    config_changed: r.config_changed === 1,
    output_revision: revision,
    output_text: text,
    output_complete: terminal,
    timing,
    usage,
    error: r.error,
    created_at: r.t_created,
  };
}
