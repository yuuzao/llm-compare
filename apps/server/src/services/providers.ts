import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { providerInputSchema, type ProviderInput, type ProviderTargetSnapshot, type ProviderView } from "@llm-compare/shared";
import type { AppContext } from "../context.ts";
import { newId, nowIso } from "../db/index.ts";
import { AppError, conflict, notFound } from "../errors.ts";

type ProviderRow = { id: string; config_json: string; credential_ref: string; deleted_at: string | null };
export class ProviderService {
  private readonly ctx: AppContext;
  constructor(ctx: AppContext) { this.ctx = ctx; }
  private row(id: string): ProviderRow {
    const row = this.ctx.db.get<ProviderRow>("SELECT * FROM providers WHERE id = ? AND deleted_at IS NULL", id);
    if (!row) throw notFound("Provider");
    return row;
  }
  private view(row: ProviderRow): ProviderView {
    return { ...JSON.parse(row.config_json) as Omit<ProviderInput, "api_key">, id: row.id, has_api_key: true };
  }
  list(): ProviderView[] { return this.ctx.db.all<ProviderRow>("SELECT * FROM providers WHERE deleted_at IS NULL ORDER BY created_at").map((r) => this.view(r)); }
  get(id: string): ProviderView { return this.view(this.row(id)); }
  save(raw: unknown, id?: string): ProviderView {
    const { api_key, ...config } = providerInputSchema.parse(raw);
    const previous = id ? this.row(id) : null;
    if (!previous && !api_key) throw new AppError("invalid_request", "新建 Provider 必须填写 API Key");
    if (this.list().some((p) => p.id !== id && p.name === config.name)) throw conflict("Provider 名称已存在");
    for (const m of config.models) for (const level of Object.keys(m.thought_levels)) {
      if (!this.ctx.db.get("SELECT 1 FROM thought_levels WHERE id = ?", level)) throw new AppError("invalid_request", "模型引用的思考强度档位不存在");
    }
    const credential = api_key ? newId() : previous!.credential_ref;
    if (api_key) {
      const dir = join(this.ctx.config.data_dir, "provider-secrets");
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(join(dir, `${credential}.yaml`), stringify({ api_key }), { mode: 0o600, flag: "wx" });
    }
    const key = id ?? newId();
    const values = { config_json: JSON.stringify(config), credential_ref: credential, updated_at: nowIso() };
    if (previous) this.ctx.db.update("providers", key, values);
    else this.ctx.db.insert("providers", { id: key, ...values, created_at: nowIso(), deleted_at: null });
    return this.get(key);
  }
  remove(id: string): void { this.row(id); this.ctx.db.update("providers", id, { deleted_at: nowIso() }); }
  snapshot(id: string, model: string): ProviderTargetSnapshot {
    const row = this.row(id);
    const config = this.view(row);
    const selected = config.models.find((m) => m.id === model);
    if (!selected) throw new AppError("unsupported_configuration", `${config.name} 未登记模型 ${model}`);
    return { kind: "provider", provider_id: id, provider_name: config.name, base_url: config.base_url, protocol: config.protocol, credential_ref: row.credential_ref, model_config: selected, base_model: model, model_value: model, thought_level_id: null, thought_level_name: null, thought_native_value: null };
  }
  secret(ref: string): string {
    if (!/^[0-9a-f-]{36}$/.test(ref)) throw new Error("Provider 凭据引用无效");
    const value = parse(readFileSync(join(this.ctx.config.data_dir, "provider-secrets", `${ref}.yaml`), "utf8")) as { api_key?: unknown };
    if (typeof value.api_key !== "string" || !value.api_key) throw new Error("Provider 凭据文件缺少 API Key");
    return value.api_key;
  }
}
