import type * as acp from "@agentclientprotocol/sdk";
import type { AgentConfigInput, ConfigOptionValue, ConfigOptionView, ThoughtOptionsResult } from "@llm-compare/shared";

export function toOptionView(opt: acp.SessionConfigOption): ConfigOptionView {
  const base = { id: opt.id, name: opt.name, category: opt.category ?? null, type: opt.type };
  if (opt.type !== "select") return { ...base, current_value: String(opt.currentValue), values: [] };
  const values = (opt.options as Array<acp.SessionConfigSelectOption | acp.SessionConfigSelectGroup>).flatMap((o): ConfigOptionValue[] =>
    "group" in o ? o.options.map((x) => ({ value: x.value, name: x.name, group: o.name })) : [{ value: o.value, name: o.name, group: null }],
  );
  return { ...base, current_value: opt.currentValue, values };
}

export function findOption(options: ConfigOptionView[], id: string): ConfigOptionView | undefined {
  return options.find((o) => o.id === id);
}

export function modelSettingsOptions(config: Pick<AgentConfigInput, "thought_mode" | "thought_config_id">, model: string | null, options: ConfigOptionView[]): ThoughtOptionsResult {
  const thoughts = options.filter((o) => o.category === "thought_level");
  // 配置项 ID 因模型而变；优先使用明确配置，再按 ACP 语义分类识别。
  // 同时存在思考开关与强度时，将多档选项作为主强度，其余保留为可选参数。
  const primary = config.thought_mode === "option"
    ? (config.thought_config_id ? findOption(options, config.thought_config_id) : undefined)
      ?? thoughts.find((o) => !o.values.every((v) => v.value === "true" || v.value === "false")) ?? thoughts[0]
    : undefined;
  const parameters = options.filter((o) => o.id !== primary?.id && (o.category === "model_config" || (config.thought_mode === "option" && o.category === "thought_level")));
  for (const o of [...(primary ? [primary] : []), ...parameters]) {
    if (o.type !== "select" || !o.values.length) throw new Error(`Agent 未提供可选择的“${o.name}”选项`);
  }
  return { mode: primary ? "option" : config.thought_mode === "in_model" ? "in_model" : "none", model_value: model, thought_config_id: primary?.id ?? null, values: primary?.values ?? [], parameters };
}
