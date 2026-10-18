import { describe, expect, it } from "vitest";
import type { ConfigOptionView } from "@llm-compare/shared";
import { modelSettingsOptions } from "../src/acp/options.ts";
import { parseCursorModelCatalog } from "../src/acp/cursor-models.ts";

// 2026-10-17 Cursor ACP 实测的配置项形状；测试选项转换，不替换 ACP 服务。
const option = (id: string, category: string, values: string[]): ConfigOptionView => ({ id, name: id, category, type: "select", current_value: values[0]!, values: values.map((value) => ({ value, name: value, group: null })) });
const config = { thought_mode: "option" as const, thought_config_id: "thought_level" };

describe("ACP 参数化模型选项", () => {
  it("模型的原生强度 ID 可以变化，不依赖登记模型", () => {
    for (const id of ["reasoning", "reasoning_effort", "effort"]) {
      const r = modelSettingsOptions(config, "gpt-5.6-sol", [option(id, "thought_level", ["none", "low", "high", "max"]), option("fast", "model_config", ["false", "true"])]);
      expect(r.thought_config_id).toBe(id);
      expect(r.values.map((o) => o.value)).toEqual(["none", "low", "high", "max"]);
      expect(r.parameters.map((o) => o.id)).toEqual(["fast"]);
    }
  });
  it("Claude 的思考开关、强度、上下文与速度均保留", () => {
    const r = modelSettingsOptions(config, "claude-opus-5", [option("thinking", "thought_level", ["false", "true"]), option("context", "model_config", ["300k", "1m"]), option("effort", "thought_level", ["low", "high", "max"]), option("fast", "model_config", ["false", "true"])]);
    expect(r.thought_config_id).toBe("effort");
    expect(r.parameters.map((o) => o.id)).toEqual(["thinking", "context", "fast"]);
  });
  it("没有独立强度时保留其他模型参数；不把空选项当作可用配置", () => {
    const r = modelSettingsOptions(config, "composer-2.5", [option("fast", "model_config", ["false", "true"])]);
    expect(r.mode).toBe("none");
    expect(r.parameters).toHaveLength(1);
    expect(() => modelSettingsOptions(config, "gpt-5.6-sol", [option("reasoning", "thought_level", [])])).toThrow("选项");
  });
});

describe("Cursor 原生模型参数目录", () => {
  const composer = { value: "composer-2.5", name: "Composer 2.5", configOptions: [{
    id: "fast", name: "Fast", category: "model_config", type: "select", currentValue: "true",
    options: [{ value: "false", name: "Off" }, { value: "true", name: "Fast" }],
  }] };
  it("直接转换目录中的原生默认值，不需要切换会话模型", () => {
    const models = parseCursorModelCatalog({ models: [composer] });
    const r = modelSettingsOptions(config, models[0]!.value, models[0]!.config_options);
    expect(r.mode).toBe("none");
    expect(r.parameters[0]!.current_value).toBe("true");
    expect(r.parameters[0]!.values.map((v) => v.value)).toEqual(["false", "true"]);
  });
  it("拒绝重复模型、空目录和非原生参数格式", () => {
    for (const models of [[composer, composer], [], [{ ...composer, configOptions: [{ type: "text" }] }]]) {
      expect(() => parseCursorModelCatalog({ models })).toThrow("模型目录格式无效");
    }
  });
});
