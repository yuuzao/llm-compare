import { EventEmitter } from "node:events";
import type { StreamEvent, StreamEventType } from "@llm-compare/shared";
import { nowIso, type Db } from "../db/index.ts";

type EventRow = { seq: number; type: StreamEventType; attempt_id: string | null; message_id: string | null; payload_json: string; created_at: string };

export const runStream = (runId: string): string => `run:${runId}`;
export const convStream = (conversationId: string): string => `conv:${conversationId}`;

export class EventStore {
  private readonly bus = new EventEmitter();

  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
    this.bus.setMaxListeners(0);
  }

  append(streamId: string, type: StreamEventType, refs: { attempt_id?: string; message_id?: string }, payload: unknown): StreamEvent {
    const event = this.db.tx(() => {
      const row = this.db.get<{ last_seq: number }>("SELECT last_seq FROM stream_seq WHERE stream_id = ?", streamId);
      const seq = (row?.last_seq ?? 0) + 1;
      if (row) this.db.run("UPDATE stream_seq SET last_seq = ? WHERE stream_id = ?", seq, streamId);
      else this.db.run("INSERT INTO stream_seq (stream_id, last_seq) VALUES (?, ?)", streamId, seq);
      const e: StreamEvent = { seq, type, attempt_id: refs.attempt_id ?? null, message_id: refs.message_id ?? null, payload, created_at: nowIso() };
      this.db.run(
        "INSERT INTO events (stream_id, seq, type, attempt_id, message_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        streamId, seq, type, e.attempt_id, e.message_id, JSON.stringify(payload), e.created_at,
      );
      return e;
    });
    this.bus.emit(streamId, event);
    return event;
  }

  lastSeq(streamId: string): number {
    return this.db.get<{ last_seq: number }>("SELECT last_seq FROM stream_seq WHERE stream_id = ?", streamId)?.last_seq ?? 0;
  }

  list(streamId: string, afterSeq: number, limit: number): StreamEvent[] {
    return this.db
      .all<EventRow>("SELECT seq, type, attempt_id, message_id, payload_json, created_at FROM events WHERE stream_id = ? AND seq > ? ORDER BY seq LIMIT ?", streamId, afterSeq, limit)
      .map(toEvent);
  }

  attemptOutput(attemptId: string, maxSeq: number): string {
    return this.db
      .all<{ payload_json: string }>("SELECT payload_json FROM events WHERE attempt_id = ? AND type = 'output_chunk' AND seq <= ? ORDER BY seq", attemptId, maxSeq)
      .map((r) => (JSON.parse(r.payload_json) as { text: string }).text)
      .join("");
  }

  maxAttemptSeq(attemptId: string): number {
    return this.db.get<{ m: number | null }>("SELECT MAX(seq) AS m FROM events WHERE attempt_id = ?", attemptId)?.m ?? 0;
  }

  subscribe(streamId: string, fn: (e: StreamEvent) => void): () => void {
    this.bus.on(streamId, fn);
    return () => this.bus.off(streamId, fn);
  }

  deleteStream(streamId: string): void {
    this.db.run("DELETE FROM events WHERE stream_id = ?", streamId);
    this.db.run("DELETE FROM stream_seq WHERE stream_id = ?", streamId);
  }
}

const toEvent = (r: EventRow): StreamEvent => ({
  seq: r.seq,
  type: r.type,
  attempt_id: r.attempt_id,
  message_id: r.message_id,
  payload: normalizePayload(r.type, JSON.parse(r.payload_json)),
  created_at: r.created_at,
});

function normalizePayload(type: StreamEventType, payload: unknown): unknown {
  if (type !== "run_update") return payload;
  const summary = payload as Record<string, unknown> & { targets: Record<string, unknown>[] };
  const { mode: _mode, thought_level_name: legacyLevel, ...rest } = summary;
  return { ...rest, target_count: summary.targets.length, targets: summary.targets.map((t) => Object.hasOwn(t, "thought_level_name") ? t : { ...t, thought_level_name: legacyLevel ?? null }) };
}
