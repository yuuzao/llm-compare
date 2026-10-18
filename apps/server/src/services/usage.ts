import type * as acp from "@agentclientprotocol/sdk";
import type { Capabilities } from "@llm-compare/shared";
import type { Row } from "../db/index.ts";
import type { Stamp, TurnResult } from "../acp/turn.ts";

const diff = (a: Stamp | null, b: Stamp | null): number | null => (a && b ? Math.round((b.mono - a.mono) * 10) / 10 : null);

export function timingColumns(r: TurnResult, createdIso: string): Row {
  return {
    t_spawn: r.t.spawn?.iso ?? null,
    t_ready: r.t.ready?.iso ?? null,
    t_prompt: r.t.prompt?.iso ?? null,
    t_first_chunk: r.t.firstChunk?.iso ?? null,
    t_end: r.t.end?.iso ?? null,
    queue_ms: r.t.spawn ? Date.parse(r.t.spawn.iso) - Date.parse(createdIso) : null,
    startup_ms: diff(r.t.spawn, r.t.ready),
    ttft_ms: diff(r.t.prompt, r.t.firstChunk),
    generation_ms: diff(r.t.prompt, r.t.end),
    total_ms: diff(r.t.spawn, r.t.end),
  };
}

export function usageColumns(usage: acp.Usage | null, update: acp.UsageUpdate | null): Row {
  return {
    input_tokens: usage?.inputTokens ?? null,
    output_tokens: usage?.outputTokens ?? null,
    total_tokens: usage?.totalTokens ?? null,
    thought_tokens: usage?.thoughtTokens ?? null,
    cached_read_tokens: usage?.cachedReadTokens ?? null,
    cached_write_tokens: usage?.cachedWriteTokens ?? null,
    prompt_usage_json: usage ? JSON.stringify(usage) : null,
    context_used: update?.used ?? null,
    context_size: update?.size ?? null,
    cost_amount: update?.cost?.amount ?? null,
    cost_currency: update?.cost?.currency ?? null,
    usage_update_json: update ? JSON.stringify(update) : null,
  };
}

export function usageReportKind(usage: acp.Usage | null, update: acp.UsageUpdate | null): Capabilities["usage_report"] {
  if (usage) return "full";
  if (update) return "context_only";
  return "none";
}
