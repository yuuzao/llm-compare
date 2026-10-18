import { HistoryIcon, SearchIcon } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router"
import { EmptyState, ErrorState, LoadingRows } from "@/components/common/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { useDebounced } from "@/hooks/use-debounced"
import { formatTime, runKindLabel, RUN_STATUS_LABEL, runVariant } from "@/lib/format"
import { useRuns } from "@/lib/queries"


export function HistoryList({ projectId }: { projectId: string }) {
  const [search, setSearch] = useState("")
  const query = useDebounced(search.trim(), 300)
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const runs = useRuns(projectId, { query, include_deleted: includeDeleted })
  const items = runs.data?.pages.flatMap((p) => p.items) ?? []
  const filtered = query !== "" || includeDeleted

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="按标题或提示词搜索" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Field orientation="horizontal" className="w-auto">
          <Switch id="include-deleted" checked={includeDeleted} onCheckedChange={setIncludeDeleted} />
          <FieldLabel htmlFor="include-deleted">显示回收站</FieldLabel>
        </Field>
      </div>
      {runs.isPending ? (
        <LoadingRows rows={4} />
      ) : runs.isError ? (
        <ErrorState title="历史记录加载失败" error={runs.error} onRetry={() => void runs.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title={filtered ? "没有符合条件的记录" : "还没有运行记录"} description={filtered ? undefined : "在工作区填写提示词并运行后，记录会出现在这里。"} icon={HistoryIcon} />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((r) => (
            <li key={r.id}>
              <Link to={`/projects/${projectId}/runs/${r.id}`} className="flex flex-col gap-1.5 rounded-lg border p-3 hover:bg-muted/50">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium">第 {r.run_number} 轮</span>
                  <Badge variant={runVariant(r.status)}>{RUN_STATUS_LABEL[r.status]}</Badge>
                  <Badge variant="outline">{runKindLabel(r.target_count)}</Badge>
                  <span className="text-muted-foreground">
                    {r.completion.succeeded}/{r.completion.total} 成功
                  </span>
                  {r.source_run_number !== null && <span className="text-muted-foreground">基于第 {r.source_run_number} 轮</span>}
                  {r.deleted && <Badge variant="destructive">回收站</Badge>}
                  <span className="ml-auto text-muted-foreground">{formatTime(r.created_at)}</span>
                </div>
                <div className="text-sm font-medium">{r.title}</div>
                <p className="line-clamp-2 text-sm whitespace-pre-wrap">{r.prompt_excerpt}</p>
                <p className="line-clamp-1 text-xs text-muted-foreground">素材：{r.material_excerpt ?? "无素材"}</p>
                <div className="flex flex-wrap gap-1">
                  {r.targets.map((t, i) => (
                    <Badge key={i} variant="secondary">
                      {t.model ? `${t.label} · ${t.model}` : t.label} · 思考 {t.thought_level_name ?? "未设置"}
                    </Badge>
                  ))}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {runs.hasNextPage && (
        <Button variant="outline" disabled={runs.isFetchingNextPage} onClick={() => void runs.fetchNextPage()}>
          {runs.isFetchingNextPage && <Spinner data-icon="inline-start" />}
          加载更多
        </Button>
      )}
    </div>
  )
}
