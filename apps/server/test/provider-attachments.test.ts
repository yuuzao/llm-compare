import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { buildSandboxHost, type AppContext } from "../src/context.ts";
import { Db } from "../src/db/index.ts";
import { EventStore } from "../src/services/events.ts";
import { Scheduler } from "../src/services/scheduler.ts";
import { WorkDirs } from "../src/services/workdir.ts";
import { ProjectService } from "../src/services/projects.ts";
import { AttachmentService, contentHash } from "../src/services/attachments.ts";
import { ProviderService } from "../src/services/providers.ts";
import { planTargets } from "../src/services/planner.ts";

const root = mkdtempSync(join(tmpdir(), "llm-compare-inputs-"));
const config = { ...loadConfig(resolve("../../config.example.yaml")), data_dir: root, work_root: join(root, "work") };
const db = new Db(":memory:");
const ctx: AppContext = { config, db, events: new EventStore(db), workdirs: new WorkDirs(config.work_root), sandboxHost: buildSandboxHost(config), scheduler: new Scheduler(1), stderrDir: root };
const providers = new ProviderService(ctx);
const files = new AttachmentService(ctx);
const projects = new ProjectService(ctx);
afterAll(() => { db.raw.close(); rmSync(root, { recursive: true, force: true }); });

describe("Provider 配置和输入持久化", () => {
  it("Key 只在私有凭据文件保存，修改后历史快照仍取原凭据", async () => {
    const key = crypto.randomUUID();
    const provider = providers.save({ name: "协议配置校验", base_url: "https://example.com/v1", protocol: "responses", api_key: key, models: [{ id: "selected-model", name: "显式模型", images: false, pdf: false, thought_levels: {} }] });
    const snapshot = providers.snapshot(provider.id, "selected-model");
    expect(JSON.stringify(provider)).not.toContain(key);
    expect(JSON.stringify(snapshot)).not.toContain(key);
    expect(JSON.stringify(db.all("SELECT * FROM providers"))).not.toContain(key);
    expect(statSync(join(root, "provider-secrets", `${snapshot.credential_ref}.yaml`)).mode & 0o777).toBe(0o600);
    const nextKey = crypto.randomUUID();
    providers.save({ name: provider.name, base_url: provider.base_url, protocol: provider.protocol, models: provider.models, api_key: nextKey }, provider.id);
    expect(providers.secret(snapshot.credential_ref)).toBe(key);
    expect(providers.secret(providers.snapshot(provider.id, "selected-model").credential_ref)).toBe(nextKey);
    const plan = await planTargets({ targets: [{ provider_id: provider.id, model: "selected-model", thought_level_id: null }, { provider_id: provider.id, model: "selected-model", thought_level_id: null }], require_clean: true }, {
      provider: (id, model) => providers.snapshot(id, model),
      agent: () => { throw new Error("此输入不应查询 Agent"); }, modelValues: () => { throw new Error("此输入不应查询 Agent 模型"); }, thoughtOptions: async () => { throw new Error("Provider 不应读取 Agent 选项"); },
      level: () => { throw new Error("此输入不应查询档位"); },
    });
    expect(plan.targets).toHaveLength(2);
    expect(plan.targets[0]).not.toBe(plan.targets[1]);
    providers.remove(provider.id);
    expect(() => providers.get(provider.id)).toThrow("不存在");
    expect(providers.secret(snapshot.credential_ref)).toBe(key);
  });
  it("上传真实说明文本，验证跨项目、重复、摘要与字节完整性", async () => {
    const p = projects.create({ title: "附件数据校验" });
    const other = projects.create({ title: "另一个项目" });
    const content = readFileSync(resolve("../../README.md"));
    const file = await files.upload(p.id, new File([content], "README.md", { type: "text/markdown" }));
    expect(files.data(file)).toEqual(content);
    expect(() => files.list(other.id, [file.id])).toThrow("不属于");
    expect(() => files.list(p.id, [file.id, file.id])).toThrow("不能重复");
    const draft = projects.patch(p.id, { expected_draft_version: p.draft_version, draft_attachment_ids: [file.id] });
    expect(draft.draft_attachments).toEqual([file]);
    expect(contentHash("提示词", [file])).not.toBe(contentHash("提示词", []));
    expect(contentHash("提示词", [file])).not.toBe(contentHash("提示词", [{ ...file, name: "renamed.md" }]));
    writeFileSync(files.path(file.id), "损坏内容");
    expect(() => files.data(file)).toThrow("校验失败");
  });
  it("拒绝扩展名伪装、无效 UTF-8 和空文件", async () => {
    const p = projects.create({ title: "格式校验" });
    await expect(files.upload(p.id, new File(["plain text"], "pretend.png", { type: "image/png" }))).rejects.toThrow("仅支持");
    await expect(files.upload(p.id, new File([new Uint8Array([255, 254, 0])], "bad.txt"))).rejects.toThrow("UTF-8");
    await expect(files.upload(p.id, new File([], "empty.txt"))).rejects.toThrow("附件为空");
  });
});
