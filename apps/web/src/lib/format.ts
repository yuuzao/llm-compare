import type { AttemptStatus, RunStatus } from "@llm-compare/shared"

export const runKindLabel = (count: number) => count > 1 ? "自由对比" : "单对象运行"

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  queued: "排队中",
  running: "运行中",
  succeeded: "全部成功",
  partial: "部分成功",
  cancelled: "已停止",
  failed: "失败",
}

export const ATTEMPT_STATUS_LABEL: Record<AttemptStatus, string> = {
  queued: "排队中",
  running: "生成中",
  cancel_requested: "正在停止",
  succeeded: "成功",
  failed: "失败",
  cancelled: "已停止",
  interrupted: "已中断",
}

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline"

export function attemptVariant(s: AttemptStatus): BadgeVariant {
  if (s === "succeeded") return "default"
  if (s === "failed" || s === "interrupted") return "destructive"
  if (s === "cancelled") return "outline"
  return "secondary"
}

export function runVariant(s: RunStatus): BadgeVariant {
  if (s === "succeeded") return "default"
  if (s === "failed") return "destructive"
  if (s === "partial" || s === "cancelled") return "outline"
  return "secondary"
}

export function formatMs(ms: number | null): string {
  if (ms === null) return "—"
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m} 分 ${s} 秒`
}

export function formatTokens(n: number | null): string {
  if (n === null) return "未上报"
  return n.toLocaleString("zh-CN")
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false })
}

export function isTerminalAttempt(s: AttemptStatus): boolean {
  return s === "succeeded" || s === "failed" || s === "cancelled" || s === "interrupted"
}

export function isActiveRun(s: RunStatus): boolean {
  return s === "queued" || s === "running"
}
