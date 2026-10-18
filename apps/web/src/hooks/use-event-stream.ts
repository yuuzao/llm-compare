import type { StreamEvent } from "@llm-compare/shared"
import { useEffect, useRef, useState } from "react"
import { ensureSession, streamUrl } from "@/lib/api"

export type StreamState = "connecting" | "open" | "reconnecting"

/** path 为 null 时不连接；断线后由 EventSource 携带 Last-Event-ID 自动续传。 */
export function useEventStream(path: string | null, after: number | null, onEvent: (e: StreamEvent) => void): StreamState {
  const handler = useRef(onEvent)
  const [state, setState] = useState<StreamState>("connecting")

  useEffect(() => {
    handler.current = onEvent
  })

  useEffect(() => {
    if (path === null || after === null) return
    let source: EventSource | null = null
    let closed = false
    void ensureSession().then(() => {
      if (closed) return
      source = new EventSource(streamUrl(path, after))
      source.onopen = () => setState("open")
      source.onerror = () => setState("reconnecting")
      source.onmessage = (msg) => handler.current(JSON.parse(msg.data as string) as StreamEvent)
    })
    return () => {
      closed = true
      source?.close()
    }
  }, [path, after])

  return state
}
