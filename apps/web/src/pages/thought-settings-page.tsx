import type { ThoughtLevelView } from "@llm-compare/shared"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { GaugeIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { EmptyState, ErrorState, LoadingRows } from "@/components/common/states"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api, errorMessage } from "@/lib/api"
import { keys, useLevels } from "@/lib/queries"


export function ThoughtSettingsPage() {
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <h1 className="text-base font-semibold">思考强度</h1>
      <div className="max-w-3xl">
        <LevelsCard />
      </div>
    </div>
  )
}

function LevelsCard() {
  const qc = useQueryClient()
  const levels = useLevels()
  const [editing, setEditing] = useState<ThoughtLevelView | "new" | null>(null)
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/thought-levels/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.levels }),
    onError: (e) => toast.error(`删除失败：${errorMessage(e)}`),
  })
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>思考强度档位</CardTitle>
        <CardDescription>供 API Provider 配置思考强度名称与原生取值。Agent 的选项在选择模型后直接读取。</CardDescription>
        <CardAction>
          <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
            <PlusIcon data-icon="inline-start" />
            新建档位
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {levels.isPending ? (
          <LoadingRows rows={2} />
        ) : levels.isError ? (
          <ErrorState error={levels.error} onRetry={() => void levels.refetch()} />
        ) : levels.data.length === 0 ? (
          <EmptyState title="还没有档位" description="例如“低”“中”“高”。" icon={GaugeIcon} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>排序</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {levels.data.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.name}</TableCell>
                  <TableCell>{l.sort}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon-sm" variant="ghost" aria-label={`编辑 ${l.name}`} onClick={() => setEditing(l)}>
                        <PencilIcon />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`删除 ${l.name}`} disabled={remove.isPending} onClick={() => remove.mutate(l.id)}>
                        <Trash2Icon />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          {editing !== null && <LevelForm key={editing === "new" ? "new" : editing.id} level={editing === "new" ? null : editing} nextSort={(levels.data?.length ?? 0) * 10 + 10} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function LevelForm({ level, nextSort, onDone }: { level: ThoughtLevelView | null; nextSort: number; onDone: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(level?.name ?? "")
  const [sort, setSort] = useState(String(level?.sort ?? nextSort))
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), sort: Number(sort) }
      return level ? api.put(`/thought-levels/${level.id}`, body) : api.post("/thought-levels", body)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.levels })
      onDone()
    },
  })
  const sortValid = /^-?\d+$/.test(sort)
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim() && sortValid) save.mutate()
      }}
    >
      <DialogHeader>
        <DialogTitle>{level ? "编辑档位" : "新建档位"}</DialogTitle>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="level-name">名称</FieldLabel>
          <Input id="level-name" autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field data-invalid={!sortValid || undefined}>
          <FieldLabel htmlFor="level-sort">排序</FieldLabel>
          <Input id="level-sort" inputMode="numeric" value={sort} aria-invalid={!sortValid || undefined} onChange={(e) => setSort(e.target.value)} />
          <FieldDescription>数字越小越靠前，必须是整数。</FieldDescription>
        </Field>
      </FieldGroup>
      {save.isError && (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(save.error)}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button type="submit" disabled={!name.trim() || !sortValid || save.isPending}>
          {save.isPending && <Spinner data-icon="inline-start" />}
          保存
        </Button>
      </DialogFooter>
    </form>
  )
}
