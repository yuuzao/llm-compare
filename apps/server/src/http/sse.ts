import type { StreamEvent } from "@llm-compare/shared";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { AppError } from "../errors.ts";
import type { EventStore } from "../services/events.ts";

export function sseResponse(c: Context, events: EventStore, streamId: string): Response {
  const lastId = c.req.header("last-event-id") ?? c.req.query("after") ?? "0";
  const after = Number(lastId);
  if (!Number.isInteger(after) || after < 0) throw new AppError("invalid_request", `事件位置无效: ${lastId}`, { after: "必须是非负整数" });
  return streamSSE(c, async (stream) => {
    let sent = after;
    const pending: StreamEvent[] = [];
    let replaying = true;
    const write = async (e: StreamEvent) => {
      if (e.seq <= sent) return;
      sent = e.seq;
      await stream.writeSSE({ id: String(e.seq), event: "message", data: JSON.stringify(e) });
    };
    const unsubscribe = events.subscribe(streamId, (e) => {
      if (replaying) pending.push(e);
      else void write(e);
    });
    stream.onAbort(unsubscribe);
    for (;;) {
      const batch = events.list(streamId, sent, 500);
      for (const e of batch) await write(e);
      if (batch.length < 500) break;
    }
    replaying = false;
    for (const e of pending) await write(e);
    while (!stream.aborted) {
      await stream.writeSSE({ event: "ping", data: "" });
      await stream.sleep(15000);
    }
    unsubscribe();
  });
}
