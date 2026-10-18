import type { AttemptView, RunPacket } from "@llm-compare/shared"
import { describe, expect, it } from "vitest"
import { appendChunk, emptyLive, mergedText, replaceAttempt } from "./live"

describe("mergedText / appendChunk", () => {
  it("没有实时数据时直接显示已保存正文", () => {
    expect(mergedText({ output_text: "已保存😀", output_revision: 8 }, undefined)).toBe("已保存😀")
  })

  it("续传时只追加快照版本之后的块，不重复快照内文本", () => {
    const live = [{ seq: 3, text: "旧内容" }, { seq: 8, text: "😀" }, { seq: 10, text: "\n新" }, { seq: 12, text: "内容" }]
      .reduce((state, chunk) => appendChunk(state, chunk), emptyLive())
    expect(mergedText({ output_text: "已保存😀", output_revision: 8 }, live)).toBe("已保存😀\n新内容")
    expect(mergedText({ output_text: "全部保存", output_revision: 12 }, live)).toBe("全部保存")
  })

  it("从空缓存开始追加，重放或迟到的旧事件不重复追加", () => {
    const live = appendChunk(undefined, { seq: 5, text: "正文" })
    expect(live.chunks).toEqual([{ seq: 5, text: "正文" }])
    expect(appendChunk(live, { seq: 5, text: "正文" })).toBe(live)
    expect(appendChunk(live, { seq: 2, text: "旧事件" })).toBe(live)
  })

  it("追加不修改旧缓存或其他实时指标，允许非连续序号与空块", () => {
    const before = { ...emptyLive(), thoughts: "思考", toolCalls: 2, contextUsed: 10, contextSize: 100 }
    const after = appendChunk(appendChunk(before, { seq: 2, text: "" }), { seq: 9, text: "好" })
    expect(before.chunks).toEqual([])
    expect(after).toEqual({ ...before, chunks: [{ seq: 2, text: "" }, { seq: 9, text: "好" }] })
  })
})

// 纯函数的边界输入；不模拟服务、网络请求或 Agent。
const attempt: AttemptView = {
  id: "attempt-1", target_id: "target-1", seq: 1, status: "running",
  agent_name: null, agent_version: null, readback_model: null, readback_thought: null, readback_readonly: null,
  stop_reason: null, readonly_check: null, readonly_check_detail: null, config_changed: false,
  output_revision: 0, output_text: "", output_complete: false, error: null, created_at: "2026-10-16T00:00:00Z",
  timing: { queue_ms: null, startup_ms: null, ttft_ms: null, generation_ms: null, total_ms: null, started_at: null, ended_at: null },
  usage: { input_tokens: null, output_tokens: null, total_tokens: null, thought_tokens: null, cached_read_tokens: null, cached_write_tokens: null,
    context_used: null, context_size: null, cost_amount: null, cost_currency: null, prompt_usage_reported: false, usage_update_reported: false },
}
const packet: RunPacket = {
  schema_version: 6, id: "run-1", project_id: "project-1", source_run_id: null, run_number: 1, title: "状态合并",
  created_at: attempt.created_at, target_count: 1, status: "running", deleted: false,
  input: { attachments: [], content_sha256: "", material: "", material_sha256: "", prompt: "", build_version: "1", submitted_text: "", submitted_sha256: "" },
  comparison: { require_clean: true },
  targets: [{ id: "target-1", position: 0, attempts: [attempt, { ...attempt, id: "attempt-2", seq: 2 }], snapshot: {
    agent_config_id: "agent-1", agent_config_name: "状态合并", base_model: null, model_value: null, thought_level_id: null, thought_level_name: null, thought_native_value: null, settings: [],
    config: { name: "状态合并", command: "/usr/bin/node", args: [], home_mode: "clean", mounts: [], env: [], model_config_id: null,
      thought_mode: "none", thought_config_id: null, readonly_config_id: null, readonly_value: null, clean_status: "unverified", clean_verification_note: null },
  } }],
  execution_context: { events_url: "/api/v1/runs/run-1/events", note: "" }, snapshot: { read_at: attempt.created_at, event_revision: 0 },
}

describe("replaceAttempt", () => {
  it("只替换已知尝试，保留其他尝试、输入与快照，不修改旧对象", () => {
    const finished: AttemptView = { ...attempt, status: "succeeded", output_text: "完成", output_revision: 8, output_complete: true }
    const updated = replaceAttempt(packet, finished)!
    expect(updated.targets[0].attempts[0]).toBe(finished)
    expect(updated.targets[0].attempts[1]).toBe(packet.targets[0].attempts[1])
    expect(updated.input).toBe(packet.input)
    expect(updated.snapshot).toBe(packet.snapshot)
    expect(packet.targets[0].attempts[0]).toBe(attempt)
    expect(packet.targets[0].attempts[0].status).toBe("running")
  })

  it("未知目标或新重试返回 null，要求调用方重新获取完整轮次", () => {
    expect(replaceAttempt(packet, { ...attempt, target_id: "unknown" })).toBeNull()
    expect(replaceAttempt(packet, { ...attempt, id: "retry-new" })).toBeNull()
  })
})
