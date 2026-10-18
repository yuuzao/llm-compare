import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { AttachmentView, TargetSnapshot } from "@llm-compare/shared";
import { targetName } from "@llm-compare/shared";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { AppContext } from "../context.ts";
import { newId, nowIso } from "../db/index.ts";
import { AppError, notFound } from "../errors.ts";
import { sha256 } from "./input-builder.ts";
import { createHash } from "node:crypto";

const fail = (message: string): never => { throw new AppError("invalid_request", message); };
export class AttachmentService {
  private readonly ctx: AppContext;
  constructor(ctx: AppContext) { this.ctx = ctx; }
  get(id: string): AttachmentView {
    const row = this.ctx.db.get<AttachmentView>("SELECT * FROM attachments WHERE id = ?", id);
    if (!row) throw notFound("附件");
    return row;
  }
  path(id: string): string {
    if (!/^[0-9a-f-]{36}$/.test(id)) return fail("附件标识无效");
    return join(this.ctx.config.data_dir, "attachments", id);
  }
  data(file: AttachmentView): Buffer {
    const data = readFileSync(this.path(file.id));
    if (data.length !== file.size || createHash("sha256").update(data).digest("hex") !== file.sha256) throw new Error(`附件 ${file.name} 内容校验失败`);
    return data;
  }
  list(projectId: string, ids: string[]): AttachmentView[] {
    if (new Set(ids).size !== ids.length) return fail("附件不能重复");
    const items = ids.map((id) => this.get(id));
    if (items.some((f) => f.project_id !== projectId)) return fail("附件不属于当前项目");
    if (items.reduce((n, f) => n + f.size, 0) > this.ctx.config.limits.max_attachments_total_bytes) return fail("本轮附件总大小超过配置限制");
    return items;
  }
  async upload(projectId: string, file: File): Promise<AttachmentView> {
    if (!this.ctx.db.get("SELECT 1 FROM projects WHERE id = ? AND deleted_at IS NULL", projectId)) throw notFound("项目");
    const { data, ...metadata } = await inspectAttachment(file, this.ctx.config.limits.max_attachment_bytes);
    const item: AttachmentView = { ...metadata, id: newId(), project_id: projectId, created_at: nowIso() };
    mkdirSync(join(this.ctx.config.data_dir, "attachments"), { recursive: true, mode: 0o700 });
    writeFileSync(this.path(item.id), data, { mode: 0o600, flag: "wx" });
    this.ctx.db.insert("attachments", item);
    return item;
  }
  validate(targets: TargetSnapshot[], files: AttachmentView[], capabilities: (id: string) => Record<string, unknown>): void {
    for (const [i, t] of targets.entries()) {
      const caps = t.kind === "provider" ? { image: t.model_config.images, embeddedContext: t.model_config.pdf } : capabilities(t.agent_config_id);
      for (const f of files) if ((f.kind === "image" && !caps.image) || (f.kind === "pdf" && !caps.embeddedContext)) {
        throw new AppError("unsupported_configuration", `对象 ${i + 1} ${targetName(t)} 未声明支持${f.kind === "image" ? "图片" : "PDF"}：${f.name}`, { [`targets.${i}`]: "附件格式不受支持" });
      }
    }
    files.forEach((f) => this.data(f));
  }
  acp(files: AttachmentView[]): ContentBlock[] {
    return files.map((f): ContentBlock => {
      const data = this.data(f);
      if (f.kind === "text") return { type: "text", text: `附件：${f.name}\n${data.toString("utf8")}` };
      if (f.kind === "image") return { type: "image", mimeType: f.mime_type, data: data.toString("base64") };
      return { type: "resource", resource: { uri: `attachment://${f.id}/${encodeURIComponent(f.name)}`, mimeType: f.mime_type, blob: data.toString("base64") } };
    });
  }
}

export function contentHash(submitted: string, files: AttachmentView[]): string {
  return sha256(JSON.stringify({ text: submitted, attachments: files.map((f) => ({ name: f.name, mime_type: f.mime_type, sha256: f.sha256 })) }));
}

export async function inspectAttachment(file: File, maxBytes: number) {
    if (!file.size || file.size > maxBytes) return fail("附件为空或超过单文件大小限制");
    const data = Buffer.from(await file.arrayBuffer());
    const ext = extname(file.name).toLowerCase();
    let mime: string;
    let kind: AttachmentView["kind"];
    if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) { mime = "image/png"; kind = "image"; }
    else if (data[0] === 255 && data[1] === 216 && data[2] === 255) { mime = "image/jpeg"; kind = "image"; }
    else if (["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString())) { mime = "image/gif"; kind = "image"; }
    else if (data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP") { mime = "image/webp"; kind = "image"; }
    else if (data.subarray(0, 5).toString() === "%PDF-") { mime = "application/pdf"; kind = "pdf"; }
    else if ([".txt", ".md", ".csv", ".tsv", ".json", ".jsonl", ".yaml", ".yml", ".log", ".xml"].includes(ext)) {
      try { new TextDecoder("utf-8", { fatal: true }).decode(data); } catch { return fail("文本附件必须是 UTF-8 编码"); }
      if (data.includes(0)) return fail("文本附件包含二进制内容");
      mime = "text/plain"; kind = "text";
    } else return fail("仅支持 PNG、JPEG、GIF、WebP 图片、PDF 和 UTF-8 文本文件");

  return { data, name: file.name.replace(/[\x00-\x1f/\\]/g, "_").slice(0, 200), mime_type: mime, kind, size: data.length, sha256: createHash("sha256").update(data).digest("hex") };
}
