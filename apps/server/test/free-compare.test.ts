import { mkdtempSync, readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createRunSchema, runListQuerySchema } from "@llm-compare/shared";
import { describe, expect, it } from "vitest";
import { Db } from "../src/db/index.ts";
import { SCHEMA_SQL as V1 } from "../src/db/schema-v1.ts";
import { EventStore } from "../src/services/events.ts";

const input = { idempotency_key: crypto.randomUUID(), material: "素材", attachment_ids: [], prompt: "提示词", source_run_id: null, require_clean: false, targets: [{ agent_config_id: "a", model: null, thought_value: null }] };
describe("自由对比协议", () => {
  it("只接受显式字段和 1—4 个对象，允许重复组合", () => {
    for (const n of [1, 2, 4]) expect(createRunSchema.parse({ ...input, targets: Array.from({ length: n }, () => input.targets[0]) }).targets).toHaveLength(n);
    for (const n of [0, 5]) expect(() => createRunSchema.parse({ ...input, targets: Array.from({ length: n }, () => input.targets[0]) })).toThrow();
    for (const field of ["thought_level_id", "mode", "common_model_id", "agent_config_id", "agent_config_ids", "model", "models"]) expect(() => createRunSchema.parse({ ...input, [field]: "old" })).toThrow();
    expect(() => createRunSchema.parse({ ...input, targets: [{ ...input.targets[0], prompt: "另一个提示词" }] })).toThrow();
    expect(() => createRunSchema.parse({ ...input, targets: [{ agent_config_id: "a", model: null }] })).toThrow();
    expect(() => createRunSchema.parse({ ...input, targets: [{ agent_config_id: "a", model: null, thought_level_id: null }] })).toThrow();
    expect(() => runListQuerySchema.parse({ mode: "model" })).toThrow();
  });
});

describe("历史数据库迁移", () => {
  it.each([[1, false], [1, true], [2, false]] as const)("版本 %s 保留记录与原始事件，损坏外键时回滚（损坏=%s）", (version, broken) => {
    const root = mkdtempSync(join(tmpdir(), "llm-compare-migration-"));
    const data = join(root, "data");
    mkdirSync(data);
    const file = join(data, "db.sqlite");
    const old = new DatabaseSync(file);
    old.exec(V1);
    old.exec(`PRAGMA user_version = ${version}; PRAGMA foreign_keys = OFF`);
    if (version === 2) old.exec("ALTER TABLE runs DROP COLUMN mode; ALTER TABLE runs DROP COLUMN common_model_name; DROP TABLE common_models;");
    old.prepare("INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("p", "迁移测试", "", "", 0, 1, "now", "now", null);
    if (broken) old.prepare("INSERT INTO material_versions VALUES (?, ?, ?, ?, ?)").run("m", "missing", "", "hash", "now");
    const payload = JSON.stringify({ id: "r", mode: "agent", thought_level_name: "高", targets: [{ label: "旧对象", model: "m" }, { label: "旧对象二", model: "n" }] });
    old.prepare("INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?)").run("run:r", 9, "run_update", null, null, payload, "original-time");
    old.close();
    writeFileSync(join(data, "snapshot.txt"), "已冻结内容");
    try {
      if (broken) {
        expect(() => new Db(file, [data])).toThrow("外键检查失败");
        const check = new DatabaseSync(file);
        expect(check.prepare("PRAGMA user_version").get()!.user_version).toBe(1);
        expect(check.prepare("SELECT name FROM sqlite_master WHERE name = 'common_models'").get()).toBeDefined();
        check.close();
      } else {
        const db = new Db(file, [data]);
        expect(db.get<{ user_version: number }>("PRAGMA user_version")!.user_version).toBe(4);
        expect(db.get("SELECT * FROM projects WHERE id = 'p'")).toBeDefined();
        expect(db.get("SELECT name FROM sqlite_master WHERE name = 'common_models'")).toBeUndefined();
        const event = new EventStore(db).list("run:r", 0, 20)[0]!;
        expect(event).toMatchObject({ seq: 9, created_at: "original-time", payload: { target_count: 2 } });
        expect(event.payload).not.toHaveProperty("mode");
        expect(event.payload).not.toHaveProperty("thought_level_name");
        expect(event.payload).toMatchObject({ targets: [{ thought_level_name: "高" }, { thought_level_name: "高" }] });
        expect(db.get<{ payload_json: string }>("SELECT payload_json FROM events")!.payload_json).toBe(payload);
        db.raw.close();
      }
      const backup = readdirSync(root).find((p) => p.startsWith(`data.backup-v${version}-`))!;
      const saved = new DatabaseSync(join(root, backup, "llm-compare.sqlite"));
      expect(saved.prepare("PRAGMA user_version").get()!.user_version).toBe(version);
      saved.close();
      expect(readFileSync(join(root, backup, "artifacts-0/snapshot.txt"), "utf8")).toBe("已冻结内容");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
