import { rmSync } from "node:fs";
import { LibraryService } from "./library.ts";
import { projectCreateSchema, projectPatchSchema, type ProjectSummary, type ProjectView, type LibrarySources } from "@llm-compare/shared";
import { AttachmentService } from "./attachments.ts";
import type { AppContext } from "../context.ts";
import { newId, nowIso } from "../db/index.ts";
import { AppError, conflict, notFound } from "../errors.ts";

type ProjectRow = {
  id: string;
  title: string;
  draft_material: string;
  draft_prompt: string;
  draft_attachment_ids: string;
  draft_version: number;
  draft_sources: string;
  created_at: string;
  updated_at: string;
  run_count: number;
  last_run_at: string | null;
  deleted_at: string | null;
};

const SELECT = `SELECT p.*, (SELECT COUNT(*) FROM runs r WHERE r.project_id = p.id AND r.deleted_at IS NULL) AS run_count,
  (SELECT MAX(created_at) FROM runs r WHERE r.project_id = p.id AND r.deleted_at IS NULL) AS last_run_at FROM projects p`;

export class ProjectService {
  private readonly ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  list(query: string | undefined, limit: number, cursor: string | undefined, includeDeleted = false): { items: ProjectSummary[]; next_cursor: string | null } {
    const params: (string | number)[] = [];
    let where = includeDeleted ? "WHERE 1 = 1" : "WHERE p.deleted_at IS NULL";
    if (query) {
      where += " AND p.title LIKE ?";
      params.push(`%${query}%`);
    }
    if (cursor) {
      const [updated, id] = decodeCursor(cursor);
      if (!updated || !id) throw new AppError("invalid_request", "cursor 无效", { cursor: "无法解析" });
      where += " AND (p.updated_at < ? OR (p.updated_at = ? AND p.id < ?))";
      params.push(updated, updated, id);
    }
    const rows = this.ctx.db.all<ProjectRow>(`${SELECT} ${where} ORDER BY p.updated_at DESC, p.id DESC LIMIT ?`, ...params, limit + 1);
    const items = rows.slice(0, limit).map(toSummary);
    const last = rows.length > limit ? items[items.length - 1]! : null;
    return { items, next_cursor: last ? encodeCursor(last.updated_at, last.id) : null };
  }

  get(id: string): ProjectView {
    const r = this.ctx.db.get<ProjectRow>(`${SELECT} WHERE p.id = ? AND p.deleted_at IS NULL`, id);
    if (!r) throw notFound("项目");
    return { ...toSummary(r), draft_material: r.draft_material, draft_prompt: r.draft_prompt, draft_version: r.draft_version, draft_sources: JSON.parse(r.draft_sources) as LibrarySources, draft_attachments: new AttachmentService(this.ctx).list(id, JSON.parse(r.draft_attachment_ids)) };
  }

  create(input: unknown): ProjectView {
    const v = projectCreateSchema.parse(input);
    const id = newId();
    const now = nowIso();
    const paths: string[] = [];
    try {
      this.ctx.db.tx(() => {
        this.ctx.db.insert("projects", { id, title: v.title, draft_material: "", draft_prompt: "", draft_version: 0, next_run_number: 1, created_at: now, updated_at: now, deleted_at: null });
        const library = new LibraryService(this.ctx);
        const material = v.material_ref ? library.copyToProject(v.material_ref, id, paths, "material") : null;
        const prompt = v.prompt_ref ? library.copyToProject(v.prompt_ref, id, paths, "prompt") : null;
        this.ctx.db.update("projects", id, { draft_material: material?.content ?? "", draft_prompt: prompt?.content ?? "", draft_attachment_ids: JSON.stringify(material?.attachments.map((f) => f.id) ?? []), draft_sources: JSON.stringify({ ...(material ? { material: material.source } : {}), ...(prompt ? { prompt: prompt.source } : {}) }) });
      });
    } catch (err) { paths.forEach((p) => rmSync(p, { force: true })); throw err; }
    return this.get(id);
  }

  delete(id: string): ProjectSummary {
    const project = this.get(id);
    const active = this.ctx.db.get<{ id: string }>("SELECT a.id FROM attempts a JOIN run_targets t ON t.id = a.target_id JOIN runs r ON r.id = t.run_id WHERE r.project_id = ? AND a.status IN ('queued', 'running', 'cancel_requested') UNION ALL SELECT m.id FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.project_id = ? AND m.status = 'running' LIMIT 1", id, id);
    if (active) throw conflict("项目有正在运行的任务，请等它们结束后再删除");
    const now = nowIso();
    this.ctx.db.update("projects", id, { deleted_at: now, updated_at: now });
    return { ...project, deleted: true };
  }

  restore(id: string): ProjectSummary {
    const project = this.ctx.db.get<ProjectRow>(`${SELECT} WHERE p.id = ? AND p.deleted_at IS NOT NULL`, id);
    if (!project) throw notFound("回收站中的项目");
    const now = nowIso();
    this.ctx.db.update("projects", id, { deleted_at: null, updated_at: now });
    return { ...toSummary(project), deleted: false };
  }

  patch(id: string, input: unknown): ProjectView {
    const v = projectPatchSchema.parse(input);
    return this.ctx.db.tx(() => {
      const cur = this.get(id);
      if (cur.draft_version !== v.expected_draft_version) {
        throw conflict(`草稿已在别处更新（当前版本 ${cur.draft_version}，提交基于 ${v.expected_draft_version}），请刷新后再编辑`);
      }
      if (v.draft_attachment_ids) new AttachmentService(this.ctx).list(id, v.draft_attachment_ids);
      this.ctx.db.update("projects", id, {
        title: v.title ?? cur.title,
        draft_material: v.draft_material ?? cur.draft_material,
        draft_prompt: v.draft_prompt ?? cur.draft_prompt,
        draft_attachment_ids: JSON.stringify(v.draft_attachment_ids ?? cur.draft_attachments.map((f) => f.id)),
        draft_version: cur.draft_version + 1,
        draft_sources: JSON.stringify(v.draft_sources ?? cur.draft_sources ?? {}),
        updated_at: nowIso(),
      });
      return this.get(id);
    });
  }
}

const toSummary = (r: ProjectRow): ProjectSummary => ({
  id: r.id,
  title: r.title,
  created_at: r.created_at,
  updated_at: r.updated_at,
  run_count: r.run_count,
  last_run_at: r.last_run_at,
  deleted: r.deleted_at !== null,
});

export function encodeCursor(...parts: string[]): string {
  return Buffer.from(JSON.stringify(parts)).toString("base64url");
}

export function decodeCursor(cursor: string): string[] {
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString()) as unknown;
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) throw new Error("bad");
    return v;
  } catch {
    throw new AppError("invalid_request", "cursor 无效", { cursor: "无法解析" });
  }
}
