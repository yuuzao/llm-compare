import type { RunPacket } from "@llm-compare/shared"
import { useMutation } from "@tanstack/react-query"
import { SquareIcon, WifiOffIcon } from "lucide-react"
import type { ReactNode } from "react"
import { toast } from "sonner"
import { ErrorState, LoadingRows } from "@/components/common/states"
import { TargetCard } from "@/components/run/target-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useRunLive } from "@/hooks/use-run-live"
import { api, errorMessage } from "@/lib/api"
import { isActiveRun, runKindLabel, RUN_STATUS_LABEL, runVariant } from "@/lib/format"
import type { LiveAttempt } from "@/lib/live"
import { cn } from "@/lib/utils"

export function RunResults({ runId, header }: { runId: string; header?: (run: RunPacket) => ReactNode }) {
  const { run, live, stream } = useRunLive(runId)
  if (run.isPending) return <LoadingRows rows={4} />
  if (run.isError) return <ErrorState title="运行记录加载失败" error={run.error} onRetry={() => void run.refetch()} />
  return <RunResultsView run={run.data} live={live} reconnecting={stream === "reconnecting"} header={header} />
}

function RunResultsView({
  run,
  live,
  reconnecting,
  header,
}: {
  run: RunPacket
  live: Record<string, LiveAttempt>
  reconnecting: boolean
  header?: (run: RunPacket) => ReactNode
}) {
  const active = isActiveRun(run.status)
  const cancelAll = useMutation({
    mutationFn: () => api.post(`/runs/${run.id}/cancel`),
    onError: (e) => toast.error(`停止失败：${errorMessage(e)}`),
  })
  const many = run.targets.length > 2

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">第 {run.run_number} 轮</h2>
        <Badge variant={runVariant(run.status)}>{RUN_STATUS_LABEL[run.status]}</Badge>
        <Badge variant="outline">{runKindLabel(run.target_count)}</Badge>
        {run.comparison.require_clean && <Badge variant="outline">要求干净环境</Badge>}
        {run.deleted && <Badge variant="destructive">已移入回收站</Badge>}
        {reconnecting && (
          <Badge variant="secondary">
            <WifiOffIcon />
            正在重连
          </Badge>
        )}
        <div className="flex-1" />
        {header?.(run)}
        {active && !run.deleted && (
          <Button size="sm" variant="outline" disabled={cancelAll.isPending} onClick={() => cancelAll.mutate()}>
            <SquareIcon data-icon="inline-start" />
            全部停止
          </Button>
        )}
      </div>
      <div className={cn("min-h-[32rem] flex-1 gap-3", many ? "flex overflow-x-auto pb-2" : "grid", run.targets.length === 2 && "grid-cols-1 lg:grid-cols-2")}>
        {run.targets.map((t) => (
          <div key={t.id} className={cn("min-h-0 min-w-0", many && "w-[30rem] shrink-0")}>
            <TargetCard runId={run.id} target={t} live={live} readOnly={run.deleted} />
          </div>
        ))}
      </div>
    </section>
  )
}
