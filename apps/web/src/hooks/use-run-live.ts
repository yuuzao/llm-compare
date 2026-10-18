import type { AttemptView, RunPacket, RunSummary, StreamEvent } from "@llm-compare/shared"
import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useState } from "react"
import { useEventStream } from "@/hooks/use-event-stream"
import { appendChunk, applyRunSummary, emptyLive, replaceAttempt, type LiveAttempt } from "@/lib/live"
import { keys, useRun } from "@/lib/queries"

export function useRunLive(runId: string) {
  const qc = useQueryClient()
  const run = useRun(runId)
  const [live, setLive] = useState<Record<string, LiveAttempt>>({})
  const [streamFrom, setStreamFrom] = useState<{ runId: string; after: number } | null>(null)

  if (run.data && run.data.id === runId && streamFrom?.runId !== runId) {
    setStreamFrom({ runId, after: run.data.snapshot.event_revision })
    setLive({})
  }

  const onEvent = useCallback(
    (e: StreamEvent) => {
      const aid = e.attempt_id
      const patchLive = (fn: (l: LiveAttempt) => LiveAttempt) => {
        if (aid === null) return
        setLive((prev) => ({ ...prev, [aid]: fn(prev[aid] ?? emptyLive()) }))
      }
      switch (e.type) {
        case "output_chunk":
          if (aid !== null) setLive((prev) => ({ ...prev, [aid]: appendChunk(prev[aid], { seq: e.seq, text: (e.payload as { text: string }).text }) }))
          return
        case "thought_chunk":
          patchLive((l) => ({ ...l, thoughts: l.thoughts + (e.payload as { text: string }).text }))
          return
        case "tool_call":
          patchLive((l) => ({ ...l, toolCalls: l.toolCalls + 1 }))
          return
        case "usage_update": {
          const p = e.payload as { used: number; size: number }
          patchLive((l) => ({ ...l, contextUsed: p.used, contextSize: p.size }))
          return
        }
        case "attempt_update": {
          const attempt = e.payload as AttemptView
          const current = qc.getQueryData<RunPacket>(keys.run(runId))
          const next = current ? replaceAttempt(current, attempt) : null
          if (next) qc.setQueryData(keys.run(runId), next)
          else void qc.invalidateQueries({ queryKey: keys.run(runId), exact: true })
          return
        }
        case "run_update": {
          const summary = e.payload as RunSummary
          const current = qc.getQueryData<RunPacket>(keys.run(runId))
          if (current) qc.setQueryData(keys.run(runId), applyRunSummary(current, summary))
          // 重试会新增排队中的尝试，run_update 是唯一通知，需要重新拉取整轮数据
          void qc.invalidateQueries({ queryKey: keys.run(runId), exact: true })
          void qc.invalidateQueries({ queryKey: keys.runs(summary.project_id) })
          void qc.invalidateQueries({ queryKey: ["projects"] })
          return
        }
        default:
          return
      }
    },
    [qc, runId],
  )

  const stream = useEventStream(streamFrom?.runId === runId ? `/runs/${runId}/stream` : null, streamFrom?.runId === runId ? streamFrom.after : null, onEvent)
  return { run, live, stream }
}
