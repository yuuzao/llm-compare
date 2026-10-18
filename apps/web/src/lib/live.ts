import type { AttemptView, RunPacket, RunSummary } from "@llm-compare/shared"

export type Chunk = { seq: number; text: string }

export type LiveAttempt = {
  chunks: Chunk[]
  thoughts: string
  toolCalls: number
  contextUsed: number | null
  contextSize: number | null
}

export const emptyLive = (): LiveAttempt => ({ chunks: [], thoughts: "", toolCalls: 0, contextUsed: null, contextSize: null })

/** 已保存文本只包含到 output_revision 为止的事件，之后的增量块按序号拼接，避免重复或遗漏。 */
export function mergedText(attempt: Pick<AttemptView, "output_text" | "output_revision">, live: LiveAttempt | undefined): string {
  if (!live) return attempt.output_text
  return attempt.output_text + live.chunks.filter((c) => c.seq > attempt.output_revision).map((c) => c.text).join("")
}

export function appendChunk(live: LiveAttempt | undefined, chunk: Chunk): LiveAttempt {
  const base = live ?? emptyLive()
  const last = base.chunks[base.chunks.length - 1]
  if (last && chunk.seq <= last.seq) return base
  return { ...base, chunks: [...base.chunks, chunk] }
}

/** 返回 null 表示缓存中没有该尝试（例如刚创建的重试），调用方需要重新拉取整轮数据。 */
export function replaceAttempt(packet: RunPacket, attempt: AttemptView): RunPacket | null {
  const target = packet.targets.find((t) => t.id === attempt.target_id)
  if (!target || !target.attempts.some((a) => a.id === attempt.id)) return null
  return {
    ...packet,
    targets: packet.targets.map((t) =>
      t.id === attempt.target_id ? { ...t, attempts: t.attempts.map((a) => (a.id === attempt.id ? attempt : a)) } : t,
    ),
  }
}

export function applyRunSummary(packet: RunPacket, summary: RunSummary): RunPacket {
  return { ...packet, status: summary.status, title: summary.title, deleted: summary.deleted }
}
