import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

type Selection = { agentName: string; modelValue: string; thoughtLevelName: string }
type Settings = {
  baseURL: string
  browserChannel: string
  timeoutMs: number
  run: Selection & { alternateThoughtLevelName: string }
  analysis: Selection
  providerNames: string[]
  comparison: { targets: Selection[]; requireClean: boolean }
}

// 本机真实 Agent 选择必须显式提供；缺少配置直接报错，不自动挑选模型。
export const settings: Settings = JSON.parse(readFileSync(new URL("../e2e.config.json", import.meta.url), "utf8"))
assert.match(settings.baseURL, /^https?:\/\//, "baseURL 必须是完整 HTTP(S) 地址")
assert.ok(settings.browserChannel, "browserChannel 必填")
assert.ok(Number.isSafeInteger(settings.timeoutMs) && settings.timeoutMs > 0, "timeoutMs 必须为正整数")
for (const selection of [settings.run, settings.analysis]) {
  for (const key of ["agentName", "modelValue", "thoughtLevelName"] as const) assert.ok(selection?.[key]?.trim(), `${key} 必填`)
}
assert.ok(settings.run.alternateThoughtLevelName?.trim(), "run.alternateThoughtLevelName 必填")
assert.notEqual(settings.run.thoughtLevelName, settings.run.alternateThoughtLevelName, "独立档位验收需要两个不同档位")
assert.ok(Array.isArray(settings.comparison.targets) && settings.comparison.targets.length >= 2 && settings.comparison.targets.length <= 4, "自由对比须选择 2—4 个对象")
for (const target of settings.comparison.targets) {
  assert.ok(target.agentName?.trim(), "agentName 必填")
  assert.ok(target.modelValue?.trim(), "modelValue 必填")
  assert.ok(target.thoughtLevelName?.trim(), "thoughtLevelName 必填")
}
assert.equal(typeof settings.comparison.requireClean, "boolean", "requireClean 必须显式指定")

assert.ok(Array.isArray(settings.providerNames) && settings.providerNames.length === 2, "providerNames 必须配置 Chat Completions 和 Responses 两个真实 Provider")
