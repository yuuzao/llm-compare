import { cpSync, existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { logger } from "../logger.ts";
import { LIBRARY_SQL, PROVIDER_ATTACHMENT_SQL, SCHEMA_SQL, SCHEMA_VERSION } from "./schema.ts";

export type Row = Record<string, SQLInputValue>;

export class Db {
  readonly raw: DatabaseSync;

  constructor(path: string, artifactPaths: string[] = []) {
    this.raw = new DatabaseSync(path);
    this.raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    try {
      this.migrate(path, artifactPaths);
    } catch (error) {
      this.raw.close();
      throw error;
    }
  }

  private migrate(path: string, artifactPaths: string[]): void {
    const current = (this.raw.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (current === SCHEMA_VERSION) return;
    if (current === 1 || current === 2 || current === 3) {
      const backupDir = join(dirname(dirname(path)), `${basename(dirname(path))}.backup-v${current}-${crypto.randomUUID()}`);
      mkdirSync(backupDir, { mode: 0o700 });
      this.raw.prepare("VACUUM INTO ?").run(join(backupDir, "llm-compare.sqlite"));
      artifactPaths.forEach((source, i) => {
        if (existsSync(source)) cpSync(source, join(backupDir, `artifacts-${i}`), {
          recursive: true,
          filter: (entry) => !entry.startsWith(`${path}.backup-`) && ![path, `${path}-wal`, `${path}-shm`].includes(entry),
        });
      });
      const tables = this.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'common_models'");
      this.tx(() => {
        const counts = tables.map(({ name }) => this.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${name}`)!.n);
        if (current === 1) this.raw.exec("ALTER TABLE runs DROP COLUMN mode; ALTER TABLE runs DROP COLUMN common_model_name; DROP TABLE common_models;");
        if (current <= 2) {
          this.raw.exec("ALTER TABLE projects ADD COLUMN draft_attachment_ids TEXT NOT NULL DEFAULT '[]'; ALTER TABLE runs ADD COLUMN attachment_ids TEXT NOT NULL DEFAULT '[]';");
          this.raw.exec(PROVIDER_ATTACHMENT_SQL);
        }
        this.raw.exec(LIBRARY_SQL);
        tables.forEach(({ name }, i) => {
          if (this.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${name}`)!.n !== counts[i]) throw new Error(`迁移前后 ${name} 记录数不一致`);
        });
        if (this.all("PRAGMA foreign_key_check").length > 0) throw new Error("迁移外键检查失败");
        const integrity = this.all<{ integrity_check: string }>("PRAGMA integrity_check");
        if (integrity.length !== 1 || integrity[0]!.integrity_check !== "ok") throw new Error("迁移完整性检查失败");
        this.raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      });
      logger.info({ version: SCHEMA_VERSION, backupDir }, "数据库迁移完成，旧数据库和关联文件已备份");
      return;
    }
    if (current !== 0) throw new Error(`数据库结构版本 ${current} 与程序期望的 ${SCHEMA_VERSION} 不一致，且没有对应的迁移`);
    this.tx(() => {
      this.raw.exec(SCHEMA_SQL + PROVIDER_ATTACHMENT_SQL + LIBRARY_SQL);
      this.raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
    logger.info({ version: SCHEMA_VERSION }, "数据库结构已初始化");
  }

  get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  run(sql: string, ...params: SQLInputValue[]): { changes: number } {
    const r = this.raw.prepare(sql).run(...params);
    return { changes: Number(r.changes) };
  }

  insert(table: string, row: Row): void {
    const keys = Object.keys(row);
    this.raw.prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...keys.map((k) => row[k] as SQLInputValue));
  }

  update(table: string, id: string, patch: Row): void {
    const keys = Object.keys(patch);
    if (keys.length === 0) throw new Error(`update ${table} 没有字段`);
    const r = this.raw.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => patch[k] as SQLInputValue), id);
    if (Number(r.changes) !== 1) throw new Error(`update ${table} id=${id} 影响 ${r.changes} 行`);
  }

  tx<T>(fn: () => T): T {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.raw.exec("COMMIT");
      return out;
    } catch (err) {
      this.raw.exec("ROLLBACK");
      throw err;
    }
  }
}

export function openDb(dataDir: string, workRoot?: string): Db {
  mkdirSync(dataDir, { recursive: true });
  return new Db(join(dataDir, "llm-compare.sqlite"), workRoot ? [dataDir, workRoot] : [dataDir]);
}

export const nowIso = (): string => new Date().toISOString();
export const newId = (): string => crypto.randomUUID();
