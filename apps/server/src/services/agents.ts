import { join } from "node:path";
import {
  agentConfigInputSchema,
  type AgentConfigInput,
  type AgentConfigView,
  type Capabilities,
  type ModelOptionView,
  type ModelCatalogEntry,
  type ProbeResult,
  type PurityCheck,
  type ThoughtOptionsResult,
} from "@llm-compare/shared";
import { buildSandboxArgv } from "../acp/sandbox.ts";
import { AcpTurn, type Setting, type TurnResult, type TurnOptions } from "../acp/turn.ts";
import { findOption, modelSettingsOptions } from "../acp/options.ts";
import { hasCursorModelCatalog, readCursorModelCatalog } from "../acp/cursor-models.ts";
import type { AppContext } from "../context.ts";
import { newId, nowIso } from "../db/index.ts";
import { AppError, notFound } from "../errors.ts";
import { logger } from "../logger.ts";

type AgentRow = {
  id: string;
  name: string;
  config_json: string;
  is_draft: number;
  probe_json: string | null;
  purity_json: string | null;
  usage_report: Capabilities["usage_report"];
  created_at: string;
  updated_at: string;
};

export const PURITY_PROMPT = "Reply with exactly the text PROBE_OK and nothing else.";
export const PURITY_EXPECTED = "PROBE_OK";

export function readonlySettings(config: AgentConfigInput): Setting[] {
  return config.readonly_config_id && config.readonly_value
    ? [{ kind: "readonly", configId: config.readonly_config_id, value: config.readonly_value }]
    : [];
}

export class AgentService {
  private readonly ctx: AppContext;
  private readonly catalogReads = new Map<string, Promise<ModelCatalogEntry[]>>();

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  private row(id: string): AgentRow {
    const r = this.ctx.db.get<AgentRow>("SELECT * FROM agent_configs WHERE id = ? AND deleted_at IS NULL", id);
    if (!r) throw notFound("Agent 配置");
    return r;
  }

  private view(r: AgentRow): AgentConfigView {
    const config = JSON.parse(r.config_json) as AgentConfigInput;
    const probe = r.probe_json ? (JSON.parse(r.probe_json) as ProbeResult) : null;
    const purity = r.purity_json ? (JSON.parse(r.purity_json) as PurityCheck) : null;
    const purityCurrent = purity !== null && purity.config_updated_at === r.updated_at;
    const modelOption = config.model_config_id && probe ? findOption(probe.config_options, config.model_config_id) : undefined;
    const capabilities: Capabilities = {
      set_model: modelOption !== undefined,
      report_model: modelOption !== undefined && modelOption.current_value !== null,
      set_thought_level: config.thought_mode !== "none",
      readonly_mode: config.readonly_config_id !== null,
      resume_session: probe ? probe.load_session || probe.resume_session : false,
      usage_report: r.usage_report,
    };
    const reasons: string[] = [];
    if (r.is_draft) reasons.push("导入的草稿尚未确认");
    if (!probe) reasons.push("尚未检测");
    if (config.model_config_id && probe && !modelOption) reasons.push(`检测结果中没有模型配置项 ${config.model_config_id}`);
    if (!purity) reasons.push("尚未进行输出纯净性检查");
    else if (!purityCurrent) reasons.push("配置修改后尚未重新进行输出纯净性检查");
    else if (!purity.passed) reasons.push("输出纯净性检查未通过");
    return {
      ...config,
      id: r.id,
      is_draft: r.is_draft === 1,
      created_at: r.created_at,
      updated_at: r.updated_at,
      probe,
      purity,
      purity_current: purityCurrent,
      capabilities,
      available: reasons.length === 0,
      unavailable_reasons: reasons,
    };
  }

  list(): AgentConfigView[] {
    return this.ctx.db.all<AgentRow>("SELECT * FROM agent_configs WHERE deleted_at IS NULL ORDER BY created_at").map((r) => this.view(r));
  }

  get(id: string): AgentConfigView {
    return this.view(this.row(id));
  }

  create(input: AgentConfigInput, isDraft: boolean): AgentConfigView {
    const config = agentConfigInputSchema.parse(input);
    const id = newId();
    const now = nowIso();
    this.ctx.db.insert("agent_configs", {
      id,
      name: config.name,
      config_json: JSON.stringify(config),
      is_draft: isDraft ? 1 : 0,
      probe_json: null,
      purity_json: null,
      usage_report: "unknown",
      created_at: now,
      updated_at: now,
      deleted_at: null,
    });
    logger.info({ agentConfigId: id, name: config.name, isDraft }, "创建 Agent 配置");
    return this.get(id);
  }

  update(id: string, input: AgentConfigInput): AgentConfigView {
    this.row(id);
    const config = agentConfigInputSchema.parse(input);
    this.ctx.db.update("agent_configs", id, { name: config.name, config_json: JSON.stringify(config), updated_at: nowIso() });
    logger.info({ agentConfigId: id }, "修改 Agent 配置");
    return this.get(id);
  }

  confirmDraft(id: string): AgentConfigView {
    const r = this.row(id);
    if (!r.is_draft) throw new AppError("conflict", "该配置不是草稿");
    this.ctx.db.update("agent_configs", id, { is_draft: 0 });
    return this.get(id);
  }

  remove(id: string): void {
    this.row(id);
    this.ctx.db.update("agent_configs", id, { deleted_at: nowIso() });
    logger.info({ agentConfigId: id }, "删除 Agent 配置");
  }

  recordUsageReport(id: string, kind: Capabilities["usage_report"]): void {
    this.ctx.db.run("UPDATE agent_configs SET usage_report = ? WHERE id = ?", kind, id);
  }

  modelOptions(id: string): ModelOptionView[] {
    const v = this.get(id);
    if (!v.model_config_id || !v.probe) return [];
    const opt = findOption(v.probe.config_options, v.model_config_id);
    if (!opt) return [];
    return opt.values.map((x) => ({ value: x.value, name: x.group ? `${x.group} / ${x.name}` : x.name, source: "agent_option" }));
  }

  private async turn(config: AgentConfigInput, label: string, settings: Setting[], promptText: string | null, callbacks: Pick<TurnOptions, "afterSettings" | "inspectAgent"> = {}): Promise<TurnResult> {
    const cwd = this.ctx.workdirs.probeDir(label);
    let argv: string[];
    try {
      argv = buildSandboxArgv(this.ctx.sandboxHost, { config, cwd });
    } catch (err) {
      throw new AppError("unsupported_configuration", `无法构建沙箱：${(err as Error).message}`);
    }
    const log = logger.child({ probe: label });
    const t = new AcpTurn({
      argv,
      sessionCwd: cwd,
      settings,
      parameterizedModelPicker: config.thought_mode !== "in_model",
      promptText,
      ...callbacks,
      startupTimeoutMs: this.ctx.config.timeouts.probe_ms,
      promptTimeoutMs: this.ctx.config.timeouts.probe_ms,
      cancelConfirmMs: this.ctx.config.timeouts.cancel_confirm_ms,
      maxOutputChars: this.ctx.config.limits.max_output_chars,
      stderrPath: join(this.ctx.stderrDir, `probe-${label}-${Date.now()}.log`),
      onEvent: () => undefined,
      log,
    });
    return t.run();
  }

  async probe(id: string): Promise<AgentConfigView> {
    const v = this.get(id);
    let catalog: ModelCatalogEntry[] | undefined;
    const r = await this.turn(v, `detect-${id}`, [], null, { afterSettings: async ({ conn, authMethods }) => {
      if (v.thought_mode !== "in_model" && hasCursorModelCatalog(authMethods)) catalog = await readCursorModelCatalog(conn);
    } });
    if (r.outcome !== "succeeded") throw new AppError("service_unavailable", `检测失败：${r.error}`);
    if (this.get(id).updated_at !== v.updated_at) throw new AppError("conflict", "Agent 配置已修改，请重新检测");
    const caps = r.agentCapabilities as { loadSession?: boolean; sessionCapabilities?: { resume?: unknown }; promptCapabilities?: Record<string, unknown> } | null;
    const probe: ProbeResult = {
      probed_at: nowIso(),
      protocol_version: r.protocolVersion!,
      agent_name: r.agentInfo?.name ?? null,
      agent_version: r.agentInfo?.version ?? null,
      load_session: caps?.loadSession === true,
      resume_session: caps?.sessionCapabilities?.resume != null,
      prompt_capabilities: caps?.promptCapabilities ?? {},
      auth_methods: r.authMethods,
      config_options: r.initialOptions,
      ...(catalog ? { model_catalog: { config_updated_at: v.updated_at, models: catalog } } : {}),
    };
    this.ctx.db.run("UPDATE agent_configs SET probe_json = ? WHERE id = ?", JSON.stringify(probe), id);
    logger.info({ agentConfigId: id, agent: probe.agent_name, version: probe.agent_version, options: probe.config_options.map((o) => o.id) }, "Agent 检测完成");
    return this.get(id);
  }

  private catalog(v: AgentConfigView): Promise<ModelCatalogEntry[]> {
    const key = JSON.stringify([v.id, v.updated_at, v.probe?.probed_at]);
    const pending = this.catalogReads.get(key);
    if (pending) return pending;
    const read = this.loadCatalog(v).finally(() => { this.catalogReads.delete(key); });
    this.catalogReads.set(key, read);
    return read;
  }

  private async loadCatalog(v: AgentConfigView): Promise<ModelCatalogEntry[]> {
    const started = performance.now();
    const captured: { models?: ModelCatalogEntry[] } = {};
    const r = await this.turn(v, `catalog-${v.id}`, [], null, { inspectAgent: async ({ conn, initialization }) => {
      if (!hasCursorModelCatalog(initialization.authMethods ?? [])) throw new Error("该 Agent 不支持 Cursor 模型目录");
      captured.models = await readCursorModelCatalog(conn);
    } });
    if (r.outcome !== "succeeded" || !captured.models) throw new AppError("service_unavailable", `读取模型目录失败：${r.error}`);
    const models = captured.models;
    const current = this.get(v.id);
    if (current.updated_at !== v.updated_at || current.probe?.probed_at !== v.probe?.probed_at) throw new AppError("conflict", "Agent 检测或配置已修改，请重新读取");
    if (!current.probe) throw new AppError("unsupported_configuration", "请先检测 Agent");
    const probe: ProbeResult = { ...current.probe, model_catalog: { config_updated_at: v.updated_at, models } };
    this.ctx.db.run("UPDATE agent_configs SET probe_json = ? WHERE id = ?", JSON.stringify(probe), v.id);
    logger.info({ agentConfigId: v.id, modelCount: models.length, ms: Math.round(performance.now() - started) }, "刷新 Agent 模型参数目录");
    return models;
  }

  async thoughtOptions(id: string, modelValue: string | null, read: { refresh?: boolean; live?: boolean } = {}): Promise<ThoughtOptionsResult> {
    const v = this.get(id);
    if (v.model_config_id) {
      if (modelValue === null || !this.modelOptions(id).some((m) => m.value === modelValue)) throw new AppError("unsupported_configuration", "请选择该 Agent 已检测到的模型");
    } else if (modelValue !== null) throw new AppError("unsupported_configuration", "该 Agent 没有模型配置项");
    if (v.thought_mode === "in_model") return { mode: "in_model", model_value: modelValue, thought_config_id: null, values: [], parameters: [] };
    if (!read.live && v.probe && hasCursorModelCatalog(v.probe.auth_methods)) {
      const saved = v.probe.model_catalog;
      const catalog = !read.refresh && saved?.config_updated_at === v.updated_at ? saved.models : await this.catalog(v);
      const model = catalog.find((m) => m.value === modelValue);
      if (!model) throw new AppError("unsupported_configuration", "模型已不在 Agent 当前目录中，请重新检测并选择");
      return modelSettingsOptions(v, modelValue, model.config_options);
    }
    let captured: ThoughtOptionsResult | null = null;
    const settings: Setting[] = v.model_config_id && modelValue !== null ? [{ kind: "model", configId: v.model_config_id, value: modelValue }] : [];
    const r = await this.turn(v, `thought-${id}`, settings, null, { afterSettings: async ({ options }) => {
      captured = modelSettingsOptions(v, modelValue, options);
    } });
    if (r.outcome !== "succeeded" || captured === null) throw new AppError("service_unavailable", `读取思考强度选项失败：${r.error}`);
    return captured;
  }

  async purityCheck(id: string): Promise<AgentConfigView> {
    const r0 = this.row(id);
    const v = this.view(r0);
    const r = await this.turn(v, `purity-${id}`, readonlySettings(v), PURITY_PROMPT);
    const received = r.outputText;
    const check: PurityCheck = {
      checked_at: nowIso(),
      passed: r.outcome === "succeeded" && received.trim() === PURITY_EXPECTED,
      received_text: received,
      error: r.outcome === "succeeded" ? null : r.error,
      config_updated_at: r0.updated_at,
    };
    this.ctx.db.run("UPDATE agent_configs SET purity_json = ? WHERE id = ?", JSON.stringify(check), id);
    logger.info({ agentConfigId: id, passed: check.passed, error: check.error }, "输出纯净性检查完成");
    return this.get(id);
  }
}
