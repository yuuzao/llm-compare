import type { AgentConfigView, AgentTargetSnapshot, ThoughtLevelView, ThoughtOptionsResult } from "@llm-compare/shared";
import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors.ts";
import { planTargets, type PlannerLookups } from "../src/services/planner.ts";

function agent(id: string, patch: Partial<AgentConfigView> = {}): AgentConfigView {
  return {
    id,
    name: `Agent ${id}`,
    command: "node",
    args: [],
    home_mode: "clean",
    mounts: [],
    env: [],
    model_config_id: "model",
    thought_mode: "option",
    thought_config_id: "reasoning_effort",
    readonly_config_id: "mode",
    readonly_value: "read-only",
    clean_status: "verified",
    clean_verification_note: "已验证",
    is_draft: false,
    created_at: "2026-10-16T00:00:00.000Z",
    updated_at: "2026-10-16T00:00:00.000Z",
    probe: null,
    purity: null,
    purity_current: true,
    capabilities: { set_model: true, report_model: true, set_thought_level: true, readonly_mode: true, resume_session: false, usage_report: "unknown" },
    available: true,
    unavailable_reasons: [],
    ...patch,
  };
}

const LOW: ThoughtLevelView = { id: "lv-low", name: "低", sort: 10 };
const HIGH: ThoughtLevelView = { id: "lv-high", name: "高", sort: 20 };

type World = { agents: AgentConfigView[]; models: Record<string, string[]>; options: Record<string, string[]> };

function lookups(w: World): PlannerLookups {
  return {
    agent: (id) => w.agents.find((a) => a.id === id)!,
    modelValues: (id) => w.models[id]!,
    thoughtOptions: async (id, model): Promise<ThoughtOptionsResult> => {
      const a = w.agents.find((a) => a.id === id)!;
      const values = w.options[`${id}/${model}`] ?? [];
      return { mode: a.thought_mode === "in_model" ? "in_model" : values.length ? "option" : "none", model_value: model, thought_config_id: values.length ? a.thought_config_id : null, parameters: [], values: values.map((v) => ({ name: v, value: v, group: null })) };
    },
    level: (id) => [LOW, HIGH].find((l) => l.id === id)!,
  };
}

async function expectUnsupported(fn: () => Promise<unknown>, text: string): Promise<void> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("unsupported_configuration");
    expect((err as AppError).message).toContain(text);
    return;
  }
  throw new Error("预期抛出 AppError");
}

const codex = agent("cx");
const cursor = agent("cur", { thought_mode: "in_model", thought_config_id: null, readonly_value: "ask", home_mode: "overlay", clean_status: "unverified", clean_verification_note: null });
const world: World = {
  agents: [codex, cursor, agent("pi", { readonly_config_id: null, readonly_value: null })],
  models: { cx: ["m1", "m2"], cur: ["gpt[effort=low]", "gpt[effort=high]", "claude"], pi: ["p1"] },
  options: { "cx/m1": ["low", "high"], "cx/m2": ["low"], "cx/m3": ["low"] },
};

describe("planTargets 同 Agent 多模型", () => {
  it("生成模型、思考强度、只读三项设置", async () => {
    const plan = await planTargets({ targets: [{"agent_config_id": "cx", "model": "m1", thought_value: "low"}, {"agent_config_id": "cx", "model": "m2", thought_value: "low"}], require_clean: true }, lookups(world));
    expect(plan.targets.map((t) => t.thought_level_name)).toEqual(["low", "low"]);
    expect(plan.targets.map((t) => (t as AgentTargetSnapshot).settings)).toEqual([
      [
        { kind: "model", config_id: "model", value: "m1" },
        { kind: "thought", config_id: "reasoning_effort", value: "low" },
        { kind: "readonly", config_id: "mode", value: "read-only" },
      ],
      [
        { kind: "model", config_id: "model", value: "m2" },
        { kind: "thought", config_id: "reasoning_effort", value: "low" },
        { kind: "readonly", config_id: "mode", value: "read-only" },
      ],
    ]);
  });

  it("拒绝不在模型当前原生选项中的取值", async () => {
    await expectUnsupported(
      () => planTargets({ targets: [{"agent_config_id": "cx", "model": "m1", thought_value: "high"}, {"agent_config_id": "cx", "model": "m2", thought_value: "high"}], require_clean: false }, lookups(world)),
      "不在 Agent 当前返回的选项中",
    );
  });

  it("未检测到的模型、未选择档位时拒绝", async () => {
    const lk = lookups(world);
    await expectUnsupported(() => planTargets({ targets: [{"agent_config_id": "cx", "model": "m1", thought_value: "low"}, {"agent_config_id": "cx", "model": "zz", thought_value: "low"}], require_clean: false }, lk), "zz 不在");
    await expectUnsupported(() => planTargets({ targets: [{"agent_config_id": "cx", "model": "m1", thought_value: null}, {"agent_config_id": "cx", "model": "m2", thought_value: null}], require_clean: false }, lk), "必须显式选择选项");
  });
});

describe("planTargets 跨 Agent 跨模型", () => {
  it("in_model 直接保留所选完整模型值，无需登记映射", async () => {
    const plan = await planTargets({ targets: [{ agent_config_id: "cx", model: "m1", thought_value: "high" }, { agent_config_id: "cur", model: "gpt[effort=high]", thought_value: null }], require_clean: false }, lookups(world));
    const cur = plan.targets[1]!;
    expect(cur.base_model).toBe("gpt[effort=high]");
    expect(cur.model_value).toBe("gpt[effort=high]");
    expect((cur as AgentTargetSnapshot).settings).toEqual([
      { kind: "model", config_id: "model", value: "gpt[effort=high]" },
      { kind: "readonly", config_id: "mode", value: "ask" },
    ]);
  });

  it("要求干净环境时拒绝沿用全局配置的 Agent", async () => {
    await expectUnsupported(
      () => planTargets({ targets: [{ agent_config_id: "cx", model: "m1", thought_value: "low" }, { agent_config_id: "cur", model: "gpt[effort=high]", thought_value: null }], require_clean: true }, lookups(world)),
      "尚未验证",
    );
  });


  it("每个对象独立指定档位，也可混合不支持思考强度的模型", async () => {
    const plan = await planTargets({ targets: [
      { agent_config_id: "cx", model: "m1", thought_value: "low" },
      { agent_config_id: "cur", model: "gpt[effort=low]", thought_value: null },
      { agent_config_id: "pi", model: "p1", thought_value: null },
    ], require_clean: false }, lookups(world));
    expect(plan.targets.map((t) => [t.thought_level_id, t.thought_level_name, t.thought_native_value])).toEqual([
      [null, "low", "low"], [null, "随模型设置", null], [null, null, null],
    ]);
  });

});

describe("planTargets 单对象运行", () => {
  it("全部不支持思考强度时不带档位，且没有只读配置项时不生成只读设置", async () => {
    const plan = await planTargets({ targets: [{ agent_config_id: "pi", model: "p1", thought_value: null }], require_clean: false }, lookups(world));
    expect(plan.targets[0]!.thought_level_id).toBeNull();
    expect((plan.targets[0]! as AgentTargetSnapshot).settings).toEqual([{ kind: "model", config_id: "model", value: "p1" }]);
  });

  it("不支持思考强度却选择了档位时拒绝", async () => {
    await expectUnsupported(() => planTargets({ targets: [{ agent_config_id: "pi", model: "p1", thought_value: "low" }], require_clean: false }, lookups(world)), "不支持独立设置");
  });

  it("可设置模型的 Agent 必须显式选择模型；不可用的 Agent 直接拒绝", async () => {
    await expectUnsupported(() => planTargets({ targets: [{ agent_config_id: "cx", model: null, thought_value: null }], require_clean: false }, lookups(world)), "必须显式选择模型");
    const down = agent("dn", { available: false, unavailable_reasons: ["尚未检测"] });
    const w: World = { ...world, agents: [...world.agents, down], models: { ...world.models, dn: [] } };
    await expectUnsupported(() => planTargets({ targets: [{ agent_config_id: "dn", model: "m1", thought_value: null }], require_clean: false }, lookups(w)), "尚未检测");
  });

  it("新模型无需登记即可使用 ACP 返回的原生选项", async () => {
    const w: World = { ...world, models: { ...world.models, cx: ["m1", "m2", "m3"] } };
    const plan = await planTargets({ targets: [{ agent_config_id: "cx", model: "m3", thought_value: "low" }], require_clean: false }, lookups(w));
    expect(plan.targets[0]!.thought_native_value).toBe("low");
  });
});


describe("自由对比对象能力", () => {
  it("同一组合可重复，保持顺序且独立构建快照", async () => {
    const targets = [{ agent_config_id: "cx", model: "m2" }, { agent_config_id: "cx", model: "m1" }, { agent_config_id: "cx", model: "m2" }];
    const plan = await planTargets({ targets: targets.map((t) => ({ ...t, thought_value: "low" })), require_clean: true }, lookups(world));
    expect(plan.targets.map((t) => t.base_model)).toEqual(["m2", "m1", "m2"]);
    expect(plan.targets[0]).not.toBe(plan.targets[2]);
  });
  it("无模型配置项的 Agent 可与其他对象对比，不能指定模型", async () => {
    const fixed = agent("fx", { model_config_id: null, thought_mode: "none", thought_config_id: null, capabilities: { ...codex.capabilities, set_model: false, report_model: false } });
    const lk = lookups({ ...world, agents: [...world.agents, fixed] });
    const input = { targets: [{ agent_config_id: "fx", model: null, thought_value: null }, { agent_config_id: "pi", model: "p1", thought_value: null }], require_clean: true };
    const plan = await planTargets(input, lk);
    expect(plan.targets[0]!.base_model).toBeNull();
    expect((plan.targets[0]! as AgentTargetSnapshot).settings.some((s) => s.kind === "model")).toBe(false);
    await expectUnsupported(() => planTargets({ ...input, targets: [{ agent_config_id: "fx", model: "m1", thought_value: null }] }, lk), "不能指定模型");
  });
  it("有模型配置项但不能回读时拒绝，也不能以 null 绕过", async () => {
    const bad = agent("bad", { capabilities: { ...codex.capabilities, report_model: false } });
    const lk = lookups({ ...world, agents: [...world.agents, bad] });
    for (const model of ["m1", null]) await expectUnsupported(() => planTargets({ targets: [{ agent_config_id: "bad", model, thought_value: null }], require_clean: false }, lk), model ? "不能设置或回读" : "必须显式选择模型");
  });
});
