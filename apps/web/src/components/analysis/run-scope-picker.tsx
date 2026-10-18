import { ErrorState, LoadingRows } from "@/components/common/states"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { runKindLabel } from "@/lib/format"
import { useRuns } from "@/lib/queries"

export function RunScopePicker({ projectId, value, onChange }: { projectId: string; value: string[]; onChange: (ids: string[]) => void }) {
  const runs = useRuns(projectId, { query: "", include_deleted: false })
  const items = runs.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <FieldSet>
      <FieldLegend variant="label">关联记录（{value.length}）</FieldLegend>
      <FieldDescription>分析时把这些轮次各对象的最新完成尝试写入只读快照目录。</FieldDescription>
      {runs.isPending ? (
        <LoadingRows rows={2} />
      ) : runs.isError ? (
        <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />
      ) : items.length === 0 ? (
        <FieldDescription>该项目还没有运行记录。</FieldDescription>
      ) : (
        <div className="flex max-h-48 flex-col gap-2 overflow-y-auto">
          {items.map((r) => (
            <Field key={r.id} orientation="horizontal">
              <Checkbox
                id={`scope-${r.id}`}
                checked={value.includes(r.id)}
                onCheckedChange={(c) => onChange(c === true ? [...value, r.id] : value.filter((x) => x !== r.id))}
              />
              <FieldLabel htmlFor={`scope-${r.id}`} className="min-w-0 font-normal">
                <span className="shrink-0">第 {r.run_number} 轮</span>
                <span className="truncate text-muted-foreground">
                  {runKindLabel(r.target_count)} · {r.title}
                </span>
              </FieldLabel>
            </Field>
          ))}
          {runs.hasNextPage && (
            <Button size="sm" variant="ghost" disabled={runs.isFetchingNextPage} onClick={() => void runs.fetchNextPage()}>
              {runs.isFetchingNextPage && <Spinner data-icon="inline-start" />}
              加载更多
            </Button>
          )}
        </div>
      )}
    </FieldSet>
  )
}
