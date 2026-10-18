import type { AgentConfigView, AgentTargetSnapshot, CreateRunInput, TargetSnapshot, ThoughtLevelView, ThoughtOptionsResult } from "@llm-compare/shared";
import { AppError } from "../errors.ts";
import { readonlySettings } from "./agents.ts";

export type PlannerLookups = {
  agent: (id: string) => AgentConfigView;
  provider?: (id: string, model: string) => Extract<TargetSnapshot, { kind: "provider" }>;
  modelValues: (agentId: string) => string[];
  thoughtOptions: (agentId: string, model: string | null) => Promise<ThoughtOptionsResult>;
  level: (id: string) => ThoughtLevelView;
};
export type Plan = { targets: TargetSnapshot[] };
type PlanInput = Pick<CreateRunInput, "targets" | "require_clean">;
function fail(message: string): never { throw new AppError("unsupported_configuration", message); }

export async function planTargets(req: PlanInput, lk: PlannerLookups): Promise<Plan> {
  // 同一个模型只探测一次；重复对象仍创建各自的不可变快照。
  const reads = new Map<string, Promise<ThoughtOptionsResult>>();
  const targets = await Promise.all(req.targets.map(async (t, i): Promise<TargetSnapshot> => {
    try {
      if ("provider_id" in t) {
        if (!lk.provider) throw new Error("未配置 Provider 查询");
        const provider = lk.provider(t.provider_id, t.model);
        const level = t.thought_level_id === null ? null : lk.level(t.thought_level_id);
        const values = provider.model_config.thought_levels;
        if (!Object.keys(values).length && level) fail("该模型不支持思考强度，请选择不设置");
        if (Object.keys(values).length && !level) fail("该模型支持思考强度，必须选择档位");
        if (level && !values[level.id]) fail(`档位“${level.name}”在该模型中没有映射`);
        return { ...provider, thought_level_id: level?.id ?? null, thought_level_name: level?.name ?? null, thought_native_value: level ? values[level.id]! : null };
      }
      const agent = lk.agent(t.agent_config_id);
      checkAgent(agent, t.model, req.require_clean, lk);
      const key = JSON.stringify([agent.id, t.model]);
      let read = reads.get(key);
      if (!read) { read = lk.thoughtOptions(agent.id, t.model); reads.set(key, read); }
      const options = await read;
      if (lk.agent(agent.id).updated_at !== agent.updated_at) fail("Agent 配置已修改，请重新选择对象");
      const value = t.thought_value;
      const selected = options.values.find((o) => o.value === value);
      if (options.mode === "option") {
        if (value === null) fail("该模型支持思考强度，必须显式选择选项");
        if (!selected) fail("所选思考强度不在 Agent 当前返回的选项中，请重新读取");
      } else if (value !== null) fail(options.mode === "in_model" ? "该 Agent 的思考强度随模型设置，请直接选择对应模型" : "该模型不支持独立设置思考强度，请选择不设置");
      const settings: AgentTargetSnapshot["settings"] = [];
      if (agent.model_config_id && t.model !== null) settings.push({ kind: "model", config_id: agent.model_config_id, value: t.model });
      if (options.mode === "option" && value !== null) settings.push({ kind: "thought", config_id: options.thought_config_id!, value });
      const parameters = t.model_parameters ?? {};
      if (Object.keys(parameters).some((id) => !options.parameters.some((o) => o.id === id))) fail("所选模型参数已失效，请重新读取");
      for (const o of options.parameters) {
        const native = parameters[o.id] ?? o.current_value;
        const selected = o.values.find((v) => v.value === native);
        if (!selected) fail(`参数“${o.name}”的取值不在 Agent 当前返回的选项中`);
        settings.push({ kind: "model_parameter", config_id: o.id, value: selected.value, name: o.name, value_name: selected.name });
      }
      for (const s of readonlySettings(agent)) settings.push({ kind: "readonly", config_id: s.configId, value: s.value });
      return {
        kind: "agent", agent_config_id: agent.id, agent_config_name: agent.name, config: stripView(agent),
        base_model: t.model, model_value: t.model, thought_level_id: null,
        thought_level_name: options.mode === "in_model" ? "随模型设置" : selected?.name ?? null,
        thought_native_value: value, settings,
      };
    } catch (error) {
      if (error instanceof AppError) throw new AppError("unsupported_configuration", `对象 ${i + 1}：${error.message}`, { [`targets.${i}`]: error.message });
      throw error;
    }
  }));
  return { targets };
}

function checkAgent(a: AgentConfigView, model: string | null, requireClean: boolean, lk: PlannerLookups): void {
  if (!a.available) fail(`${a.name} 当前不可用：${a.unavailable_reasons.join("；")}`);
  if (a.model_config_id) {
    if (model === null) fail(`${a.name} 必须显式选择模型`);
    if (!a.capabilities.set_model || !a.capabilities.report_model) fail(`${a.name} 不能设置或回读模型，请重新检测`);
  } else if (model !== null) fail(`${a.name} 没有模型配置项，不能指定模型`);
  if (requireClean && !(a.home_mode === "clean" && a.clean_status === "verified")) fail(`本轮要求干净环境，但 ${a.name} 的干净环境尚未验证`);
  if (model !== null && !lk.modelValues(a.id).includes(model)) fail(`模型 ${model} 不在 ${a.name} 已检测到的模型选项中，请重新检测`);
}

function stripView(a: AgentConfigView): AgentTargetSnapshot["config"] {
  return {
    name: a.name, command: a.command, args: a.args, home_mode: a.home_mode, mounts: a.mounts, env: a.env,
    model_config_id: a.model_config_id, thought_mode: a.thought_mode, thought_config_id: a.thought_config_id,
    readonly_config_id: a.readonly_config_id, readonly_value: a.readonly_value, clean_status: a.clean_status,
    clean_verification_note: a.clean_verification_note,
  };
}
