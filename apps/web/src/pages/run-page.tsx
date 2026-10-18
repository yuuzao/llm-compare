import { AttachmentList } from "@/components/project/attachment-editor"
import type { ProjectView, RunPacket } from "@llm-compare/shared"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeftIcon,
  CornerDownRightIcon,
  MessageSquareTextIcon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react"
import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { toast } from "sonner"
import { AnalysisSheet } from "@/components/analysis/analysis-sheet"
import { CopyButton } from "@/components/common/copy-button"
import { RunResults } from "@/components/run/run-results"
import { targetLabel } from "@/components/run/target-card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api, errorMessage } from "@/lib/api"
import { formatTime, isActiveRun } from "@/lib/format"
import { keys, useRun } from "@/lib/queries"

const SETTING_LABEL = {
  model: "模型",
  thought: "思考强度",
  model_parameter: "模型参数",
  readonly: "只读模式",
} as const

export function RunPage() {
  const { projectId, runId } = useParams()
  const [analysisOpen, setAnalysisOpen] = useState(false)
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        <Button asChild size="sm" variant="ghost">
          <Link to={`/projects/${projectId}?tab=history`}>
            <ArrowLeftIcon data-icon="inline-start" />
            返回历史
          </Link>
        </Button>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAnalysisOpen(true)}
        >
          <MessageSquareTextIcon data-icon="inline-start" />
          分析
        </Button>
      </div>
      <div className="flex shrink-0 flex-col">
        <RunResults
          key={runId}
          runId={runId!}
          header={(run) => <RunActions run={run} />}
        />
      </div>
      <RunInputDetails runId={runId!} />
      <AnalysisSheet
        projectId={projectId!}
        open={analysisOpen}
        onOpenChange={setAnalysisOpen}
        suggestedRunId={runId!}
      />
    </div>
  )
}

function RunInputDetails({ runId }: { runId: string }) {
  const { data: run } = useRun(runId)
  if (!run) return null
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {Object.keys(run.input.library_sources ?? {}).length > 0 && (
        <div className="rounded-lg border p-3 text-xs text-muted-foreground lg:col-span-2">
          内容来源：
          {Object.entries(run.input.library_sources ?? {})
            .map(
              ([kind, source]) =>
                `${kind === "material" ? "素材" : "提示词"}「${source.title}」版本 ${source.version}`
            )
            .join(" · ")}
          （使用当轮副本）
        </div>
      )}
      {run.input.attachments.length > 0 && (
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>输入附件</CardTitle>
          </CardHeader>
          <CardContent>
            <AttachmentList files={run.input.attachments} />
          </CardContent>
        </Card>
      )}
      <Card size="sm">
        <CardHeader>
          <CardTitle>提示词</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <pre className="max-h-64 overflow-y-auto rounded-md bg-muted p-3 text-sm whitespace-pre-wrap">
            {run.input.prompt}
          </pre>
          <div className="flex gap-1">
            <CopyButton text={run.input.prompt} label="复制提示词" />
            <CopyButton
              text={run.input.submitted_text}
              label="复制实际提交内容"
            />
          </div>
        </CardContent>
      </Card>
      <Card size="sm">
        <CardHeader>
          <CardTitle>素材</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {run.input.material ? (
            <Collapsible>
              <pre className="max-h-24 overflow-hidden rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
                {run.input.material}
              </pre>
              <CollapsibleContent>
                <pre className="mt-2 max-h-[50svh] overflow-y-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">
                  {run.input.material}
                </pre>
              </CollapsibleContent>
              <div className="flex gap-1">
                <CollapsibleTrigger asChild>
                  <Button size="sm" variant="ghost">
                    查看全文
                  </Button>
                </CollapsibleTrigger>
                <CopyButton text={run.input.material} label="复制素材" />
              </div>
            </Collapsible>
          ) : (
            <p className="text-sm text-muted-foreground">无素材</p>
          )}
        </CardContent>
      </Card>
      <Card size="sm" className="lg:col-span-2">
        <CardHeader>
          <CardTitle>配置快照</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>对象</TableHead>
                <TableHead>环境</TableHead>
                <TableHead>会话设置</TableHead>
                <TableHead>执行配置</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.targets.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="align-top">{targetLabel(t)}</TableCell>
                  <TableCell className="align-top">
                    {t.snapshot.kind === "provider"
                      ? "单轮 API"
                      : t.snapshot.config.home_mode === "clean"
                        ? "干净"
                        : "沿用全局配置"}
                  </TableCell>
                  <TableCell className="align-top">
                    {t.snapshot.kind === "provider"
                      ? `模型 ${t.snapshot.model_value} · 思考强度 ${t.snapshot.thought_native_value ?? "未设置"}`
                      : t.snapshot.settings.length === 0
                        ? "未指定"
                        : t.snapshot.settings.map((s) => (
                            <div
                              key={s.config_id}
                              className="font-mono text-xs"
                            >
                              {s.name ?? SETTING_LABEL[s.kind]}：
                              {s.value_name ?? s.value}
                            </div>
                          ))}
                  </TableCell>
                  <TableCell className="max-w-96 align-top font-mono text-xs break-all whitespace-normal">
                    {t.snapshot.kind === "provider"
                      ? `${t.snapshot.protocol === "responses" ? "Responses" : "Chat Completions"} · ${t.snapshot.base_url}`
                      : [
                          t.snapshot.config.command,
                          ...t.snapshot.config.args,
                        ].join(" ")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">
            创建于 {formatTime(run.created_at)} · 输入构建版本{" "}
            {run.input.build_version}
            。相同思考强度档位不代表不同模型的内部行为完全相同。
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function RunActions({ run }: { run: RunPacket }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(run.title)
  const [confirm, setConfirm] = useState<"trash" | "permanent" | null>(null)
  const active = isActiveRun(run.status)

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.run(run.id), exact: true })
    void qc.invalidateQueries({ queryKey: keys.runs(run.project_id) })
    void qc.invalidateQueries({ queryKey: ["projects"] })
  }
  const rename = useMutation({
    mutationFn: () => api.patch(`/runs/${run.id}`, { title: title.trim() }),
    onSuccess: () => {
      setRenaming(false)
      refresh()
    },
    onError: (e) => toast.error(`重命名失败：${errorMessage(e)}`),
  })
  const remove = useMutation({
    mutationFn: (permanent: boolean) =>
      api.del(`/runs/${run.id}${permanent ? "?permanent=true" : ""}`),
    onSuccess: (_, permanent) => {
      setConfirm(null)
      if (permanent) {
        qc.removeQueries({ queryKey: keys.run(run.id) })
        void qc.invalidateQueries({ queryKey: keys.runs(run.project_id) })
        void qc.invalidateQueries({ queryKey: ["projects"] })
        void navigate(`/projects/${run.project_id}?tab=history`)
      } else refresh()
    },
    onError: (e) => toast.error(`删除失败：${errorMessage(e)}`),
  })
  const restore = useMutation({
    mutationFn: () => api.post(`/runs/${run.id}/restore`),
    onSuccess: refresh,
    onError: (e) => toast.error(`恢复失败：${errorMessage(e)}`),
  })
  const continueFrom = useMutation({
    mutationFn: async () => {
      const p = await api.get<ProjectView>(`/projects/${run.project_id}`)
      return api.patch<ProjectView>(`/projects/${run.project_id}`, {
        draft_material: run.input.material,
        draft_prompt: run.input.prompt,
        draft_attachment_ids: run.input.attachments.map((f) => f.id),
        draft_sources: run.input.library_sources ?? {},
        expected_draft_version: p.draft_version,
      })
    },
    onSuccess: (p) => {
      qc.setQueryData(keys.project(p.id), p)
      void navigate(`/projects/${p.id}?from=${run.id}`)
    },
    onError: (e) => toast.error(`载入失败：${errorMessage(e)}`),
  })

  return (
    <>
      <span className="max-w-72 truncate text-sm text-muted-foreground">
        {run.title}
      </span>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => (setTitle(run.title), setRenaming(true))}
      >
        <PencilIcon data-icon="inline-start" />
        重命名
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={continueFrom.isPending}
        onClick={() => continueFrom.mutate()}
      >
        <CornerDownRightIcon data-icon="inline-start" />
        基于此轮继续
      </Button>
      {run.deleted ? (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={restore.isPending}
            onClick={() => restore.mutate()}
          >
            <RotateCcwIcon data-icon="inline-start" />
            恢复
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={active}
            onClick={() => setConfirm("permanent")}
          >
            永久删除
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setConfirm("trash")}>
          <Trash2Icon data-icon="inline-start" />
          删除
        </Button>
      )}
      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (title.trim()) rename.mutate()
            }}
          >
            <DialogHeader>
              <DialogTitle>重命名第 {run.run_number} 轮</DialogTitle>
            </DialogHeader>
            <Input
              aria-label="标题"
              autoFocus
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <DialogFooter>
              <Button
                type="submit"
                disabled={!title.trim() || rename.isPending}
              >
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "permanent" ? "永久删除这一轮？" : "移入回收站？"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "permanent"
                ? "输入快照、所有尝试的输出和执行事件都会被清除，无法恢复。引用这一轮的分析回复会标记为“来源已永久删除”。"
                : "默认列表将不再显示这一轮，可在历史中打开“显示回收站”后恢复。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant={confirm === "permanent" ? "destructive" : "default"}
              onClick={() => remove.mutate(confirm === "permanent")}
            >
              {confirm === "permanent" ? "永久删除" : "移入回收站"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
