import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { librarySaveSchema, type LibraryRef, type LibraryItemView, type LibraryAttachmentView, type LibraryAppliedView, type AttachmentView } from "@llm-compare/shared";
import type { AppContext } from "../context.ts";
import { newId, nowIso } from "../db/index.ts";
import { AppError, conflict, notFound } from "../errors.ts";
import { AttachmentService, inspectAttachment } from "./attachments.ts";

type ItemRow = { id: string; kind: "material" | "prompt"; title: string; content: string; attachment_ids: string; version: number; created_at: string; updated_at: string; deleted_at: string | null };
const fail = (message: string): never => { throw new AppError("invalid_request", message); };
export class LibraryService {
  private readonly ctx: AppContext;
  constructor(ctx: AppContext) { this.ctx = ctx; }

  private row(id: string): ItemRow {
    const row = this.ctx.db.get<ItemRow>("SELECT * FROM library_items WHERE id = ?", id);
    if (!row) throw notFound("内容库条目");
    return row;
  }
  get(id: string): LibraryItemView {
    const row = this.row(id);
    return { id: row.id, kind: row.kind, title: row.title, content: row.content, version: row.version, created_at: row.created_at, updated_at: row.updated_at, deleted: row.deleted_at !== null, attachments: (JSON.parse(row.attachment_ids) as string[]).map((id) => this.file(id)) };
  }
  file(id: string): LibraryAttachmentView {
    const file = this.ctx.db.get<LibraryAttachmentView>("SELECT * FROM library_attachments WHERE id = ?", id);
    if (!file) throw notFound("内容库附件");
    return file;
  }
  path(id: string): string {
    if (!/^[0-9a-f-]{36}$/.test(id)) return fail("附件标识无效");
    return join(this.ctx.config.data_dir, "library-attachments", id);
  }
  data(file: LibraryAttachmentView): Buffer {
    const data = readFileSync(this.path(file.id));
    if (data.length !== file.size || createHash("sha256").update(data).digest("hex") !== file.sha256) throw new AppError("service_unavailable", "内容库附件校验失败，请重新上传");
    return data;
  }
  list(q: { kind: "material" | "prompt"; query: string; include_deleted?: string; limit: number; cursor?: string }) {
    const params: (string | number)[] = [q.kind];
    let where = "WHERE kind = ?";
    if (q.include_deleted !== "true") where += " AND deleted_at IS NULL";
    if (q.query) { where += " AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')"; const term = `%${q.query.replace(/[\\%_]/g, "\\$&")}%`; params.push(term, term); }
    if (q.cursor) {
      let cursor: unknown;
      try { cursor = JSON.parse(Buffer.from(q.cursor, "base64url").toString()); } catch { return fail("分页参数无效"); }
      if (!Array.isArray(cursor) || cursor.length !== 2 || !cursor.every((x) => typeof x === "string")) return fail("分页参数无效");
      where += " AND (updated_at < ? OR (updated_at = ? AND id < ?))"; params.push(cursor[0]!, cursor[0]!, cursor[1]!);
    }
    const rows = this.ctx.db.all<ItemRow>(`SELECT * FROM library_items ${where} ORDER BY updated_at DESC, id DESC LIMIT ?`, ...params, q.limit + 1);
    const items = rows.slice(0, q.limit).map((row) => this.get(row.id));
    const last = rows.length > q.limit ? items.at(-1) : null;
    return { items, next_cursor: last ? Buffer.from(JSON.stringify([last.updated_at, last.id])).toString("base64url") : null };
  }
  async save(input: unknown, uploads: File[], id?: string): Promise<LibraryItemView> {
    const v = librarySaveSchema.parse(input);
    if (uploads.length > 10) return fail("每个素材最多 10 个附件");
    const incoming = await Promise.all(uploads.map((f) => inspectAttachment(f, this.ctx.config.limits.max_attachment_bytes)));
    if (v.source_attachment_ids.length && !v.source_project_id) return fail("复制项目附件时必须指定来源项目");
    const copiedPaths: string[] = [];
    const itemId = id ?? newId();
    try {
      this.ctx.db.tx(() => {
        const old = id ? this.get(id) : null;
        if (old?.deleted) throw conflict("条目已删除，请先恢复");
        if (old && (old.version !== v.expected_version || old.kind !== v.kind)) throw conflict("条目已修改，请重新打开后编辑");
        if (!old && v.attachment_ids.length) return fail("新条目不能引用其他条目的附件");
        if (new Set(v.attachment_ids).size !== v.attachment_ids.length || v.attachment_ids.some((fileId) => !old?.attachments.some((f) => f.id === fileId))) return fail("附件不属于当前内容库条目");
        const retained = v.attachment_ids.map((fileId) => this.file(fileId));
        retained.forEach((f) => this.data(f));
        const projectFiles = new AttachmentService(this.ctx);
        if (v.source_project_id && !this.ctx.db.get("SELECT 1 FROM projects WHERE id = ? AND deleted_at IS NULL", v.source_project_id)) throw notFound("来源项目");
        const source = v.source_project_id ? projectFiles.list(v.source_project_id, v.source_attachment_ids) : [];
        const additions = [...source.map((f) => ({ ...f, data: projectFiles.data(f) })), ...incoming];
        const all = [...retained, ...additions];
        if (all.length > 10 || all.reduce((n, f) => n + f.size, 0) > this.ctx.config.limits.max_attachments_total_bytes) return fail("附件数量或合计大小超过限制");
        if (v.kind === "prompt" && (all.length || !v.content.trim())) return fail("提示词正文不能为空，且不支持附件");
        if (v.kind === "material" && !all.length && !v.content.trim()) return fail("素材正文或附件至少需要一项");
        const now = nowIso();
        if (!old) this.ctx.db.insert("library_items", { id: itemId, kind: v.kind, title: v.title, content: v.content, attachment_ids: "[]", version: 1, created_at: now, updated_at: now, deleted_at: null });
        const ids = [...v.attachment_ids];
        for (const f of additions) {
          const file: LibraryAttachmentView = { id: newId(), library_item_id: itemId, name: f.name, mime_type: f.mime_type, kind: f.kind, size: f.size, sha256: f.sha256, created_at: now };
          mkdirSync(join(this.ctx.config.data_dir, "library-attachments"), { recursive: true, mode: 0o700 });
          const path = this.path(file.id); writeFileSync(path, f.data, { mode: 0o600, flag: "wx" }); copiedPaths.push(path);
          this.ctx.db.insert("library_attachments", file); ids.push(file.id);
        }
        this.ctx.db.update("library_items", itemId, { title: v.title, content: v.content, attachment_ids: JSON.stringify(ids), version: old ? old.version + 1 : 1, updated_at: now });
      });
    } catch (err) { copiedPaths.forEach((p) => rmSync(p, { force: true })); throw err; }
    return this.get(itemId);
  }
  remove(id: string): void { this.get(id); this.ctx.db.update("library_items", id, { deleted_at: nowIso(), updated_at: nowIso() }); }
  restore(id: string): LibraryItemView { this.get(id); this.ctx.db.update("library_items", id, { deleted_at: null, updated_at: nowIso() }); return this.get(id); }
  resolve(ref: LibraryRef, kind?: "material" | "prompt"): LibraryItemView {
    const item = this.get(ref.id);
    if (item.deleted) throw conflict("内容库条目已删除，请重新选择");
    if (item.version !== ref.version) throw conflict("内容库条目已修改，请刷新预览后重新选择");
    if (kind && item.kind !== kind) return fail("内容类型不匹配");
    return item;
  }
  // 调用方负责数据库事务；路径用于事务失败时清理已复制文件。
  copyToProject(ref: LibraryRef, projectId: string, paths: string[], kind?: "material" | "prompt"): LibraryAppliedView {
    const item = this.resolve(ref, kind);
    const files: AttachmentView[] = [];
    const attachments = new AttachmentService(this.ctx);
    for (const source of item.attachments) {
      const file: AttachmentView = { id: newId(), project_id: projectId, name: source.name, mime_type: source.mime_type, kind: source.kind, size: source.size, sha256: source.sha256, created_at: nowIso() };
      const data = this.data(source);
      mkdirSync(join(this.ctx.config.data_dir, "attachments"), { recursive: true, mode: 0o700 });
      const path = attachments.path(file.id); writeFileSync(path, data, { mode: 0o600, flag: "wx" }); paths.push(path);
      this.ctx.db.insert("attachments", file); files.push(file);
    }
    attachments.list(projectId, files.map((f) => f.id));
    return { kind: item.kind, content: item.content, attachments: files, source: { id: item.id, version: item.version, title: item.title } };
  }
  apply(projectId: string, ref: LibraryRef): LibraryAppliedView {
    if (!this.ctx.db.get("SELECT 1 FROM projects WHERE id = ? AND deleted_at IS NULL", projectId)) throw notFound("项目");
    const paths: string[] = [];
    try { return this.ctx.db.tx(() => this.copyToProject(ref, projectId, paths)); }
    catch (err) { paths.forEach((p) => rmSync(p, { force: true })); throw err; }
  }
}
