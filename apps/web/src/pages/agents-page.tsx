import type { AgentConfigInput, AgentConfigView } from "@llm-compare/shared"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { BotIcon, CheckIcon, DownloadIcon, PencilIcon, PlusIcon, RadarIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"
import { NavLink, useNavigate, useParams } from "react-router"
import { toast } from "sonner"
import { AgentFormDialog } from "@/components/agents/agent-form"
import { EmptyState, ErrorState, LoadingRows } from "@/components/common/states"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api, errorMessage } from "@/lib/api"
import { formatTime } from "@/lib/format"
import { keys, useAgents } from "@/lib/queries"
import { cn } from "@/lib/utils"

const CLEAN_LABEL: Record<AgentConfigInput["clean_status"], string> = { unverified: "未验证", verified: "已验证干净", not_guaranteed: "不保证干净" }
const USAGE_LABEL = { full: "完整上报", context_only: "仅上下文占用", none: "不上报", unknown: "尚未运行过" } as const

export function AgentsPage() {
  const { agentId } = useParams()
  const agents = useAgents()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [formOpen, setFormOpen] = useState(false)

  const importVerified = useMutation({
    mutationFn: () => api.post<{ created: AgentConfigView[]; errors: string[] }>("/agent-configs/import-verified"),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: keys.agents })
      if (r.created.length > 0) toast.success(`已导入 ${r.created.length} 份草稿，确认并通过纯净性检查后才能使用`)
      for (const e of r.errors) toast.error(e)
    },
    onError: (e) => toast.error(`导入失败：${errorMessage(e)}`),
  })

  const selected = agents.data?.find((a) => a.id === agentId) ?? null

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold">Agent 配置</h1>
          <Button size="sm" variant="outline" onClick={() => setFormOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            新建
          </Button>
        </div>
        <Button size="sm" variant="ghost" className="self-start" disabled={importVerified.isPending} onClick={() => importVerified.mutate()}>
          {importVerified.isPending ? <Spinner data-icon="inline-start" /> : <DownloadIcon data-icon="inline-start" />}
          导入本机配置为草稿
        </Button>
        {agents.isPending ? (
          <LoadingRows rows={4} />
        ) : agents.isError ? (
          <ErrorState error={agents.error} onRetry={() => void agents.refetch()} />
        ) : agents.data.length === 0 ? (
          <EmptyState title="还没有 Agent 配置" description="新建配置，或导入本机 Pi、Codex、Cursor、DeepSeek Harness 的全局或干净环境配置。" icon={BotIcon} />
        ) : (
          <nav className="flex flex-col gap-1">
            {agents.data.map((a) => (
              <NavLink
                key={a.id}
                to={`/settings/agents/${a.id}`}
                className={({ isActive }) => cn("flex flex-col gap-1 rounded-md border p-2 text-sm hover:bg-muted/50", isActive && "border-primary bg-muted")}
              >
                <span className="truncate font-medium">{a.name}</span>
                <span className="flex flex-wrap gap-1">
                  {a.is_draft && <Badge variant="secondary">草稿</Badge>}
                  <Badge variant={a.available ? "default" : "outline"}>{a.available ? "可用" : "不可用"}</Badge>
                  <Badge variant="outline">{a.home_mode === "clean" ? CLEAN_LABEL[a.clean_status] : "沿用全局配置"}</Badge>
                </span>
              </NavLink>
            ))}
          </nav>
        )}
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto p-4">
        {agentId && agents.isSuccess && !selected ? (
          <EmptyState title="配置不存在或已删除" icon={BotIcon} />
        ) : selected ? (
          <AgentDetail key={selected.id} agent={selected} onDeleted={() => void navigate("/settings/agents")} />
        ) : (
          <EmptyState title="选择一个配置查看详情" description="可以检测 ACP 能力并执行输出纯净性检查；思考强度在选择模型后自动读取。" icon={BotIcon} />
        )}
      </div>
      <AgentFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        agent={null}
        onSaved={(a) => {
          setFormOpen(false)
          void navigate(`/settings/agents/${a.id}`)
        }}
      />
    </div>
  )
}

function useAgentCacheUpdate() {
  const qc = useQueryClient()
  return (a: AgentConfigView) => {
    qc.setQueryData<AgentConfigView[]>(keys.agents, (prev) => prev?.map((x) => (x.id === a.id ? a : x)))
    void qc.invalidateQueries({ queryKey: keys.models(a.id) })
  }
}

function useAgentAction(agentId: string, path: string, label: string) {
  const update = useAgentCacheUpdate()
  return useMutation({
    mutationFn: () => api.post<AgentConfigView>(`/agent-configs/${agentId}/${path}`),
    onSuccess: update,
    onError: (e) => toast.error(`${label}失败：${errorMessage(e)}`),
  })
}

function AgentDetail({ agent, onDeleted }: { agent: AgentConfigView; onDeleted: () => void }) {
  const qc = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const update = useAgentCacheUpdate()
  const probe = useAgentAction(agent.id, "probe", "检测")
  const purity = useAgentAction(agent.id, "purity-check", "纯净性检查")
  const confirm = useAgentAction(agent.id, "confirm", "确认")
  const remove = useMutation({
    mutationFn: () => api.del(`/agent-configs/${agent.id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.agents })
      onDeleted()
    },
    onError: (e) => toast.error(`删除失败：${errorMessage(e)}`),
  })

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{agent.name}</h2>
        {agent.is_draft && <Badge variant="secondary">草稿</Badge>}
        <Badge variant={agent.available ? "default" : "outline"}>{agent.available ? "可用" : "不可用"}</Badge>
        <div className="flex-1" />
        {agent.is_draft && (
          <Button size="sm" disabled={confirm.isPending} onClick={() => confirm.mutate()}>
            <CheckIcon data-icon="inline-start" />
            确认草稿
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={probe.isPending} onClick={() => probe.mutate()}>
          {probe.isPending ? <Spinner data-icon="inline-start" /> : <RadarIcon data-icon="inline-start" />}
          检测
        </Button>
        <Button size="sm" variant="outline" disabled={purity.isPending} onClick={() => purity.mutate()}>
          {purity.isPending ? <Spinner data-icon="inline-start" /> : <ShieldCheckIcon data-icon="inline-start" />}
          纯净性检查
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)}>
          <PencilIcon data-icon="inline-start" />
          编辑
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
          <Trash2Icon data-icon="inline-start" />
          删除
        </Button>
      </div>

      {!agent.available && (
        <Alert>
          <AlertTitle>暂不可用</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {agent.unavailable_reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle>启动与环境</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <code className="rounded bg-muted p-2 font-mono text-xs break-all">{[agent.command, ...agent.args].join(" ")}</code>
            <div>主目录：{agent.home_mode === "clean" ? `干净（${CLEAN_LABEL[agent.clean_status]}）` : "沿用全局配置（临时叠加，写入随进程丢弃）"}</div>
            {agent.clean_verification_note && <p className="text-xs text-muted-foreground">{agent.clean_verification_note}</p>}
            {agent.mounts.length > 0 && (
              <ul className="flex flex-col gap-0.5 font-mono text-xs">
                {agent.mounts.map((m, i) => (
                  <li key={i} className="break-all">
                    [{m.mode}] {m.host_path}
                    {m.sandbox_path && ` → ${m.sandbox_path}`}
                  </li>
                ))}
              </ul>
            )}
            {agent.env.length > 0 && <div className="font-mono text-xs">环境变量：{agent.env.map((e) => e.name).join("、")}</div>}
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>能力</CardTitle>
            <CardDescription>来自检测结果与配置声明</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            <Badge variant={agent.capabilities.set_model ? "default" : "outline"}>{agent.capabilities.set_model ? "可设置模型" : "不能设置模型"}</Badge>
            <Badge variant={agent.capabilities.set_thought_level ? "default" : "outline"}>
              {agent.thought_mode === "in_model" ? "思考强度随模型取值" : agent.capabilities.set_thought_level ? "可设置思考强度" : "不支持思考强度"}
            </Badge>
            <Badge variant={agent.capabilities.readonly_mode ? "default" : "outline"}>{agent.capabilities.readonly_mode ? `只读模式 ${agent.readonly_value}` : "无只读模式（由沙箱保证）"}</Badge>
            <Badge variant="outline">用量：{USAGE_LABEL[agent.capabilities.usage_report]}</Badge>
          </CardContent>
        </Card>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>输出纯净性检查</CardTitle>
          <CardDescription>要求 Agent 只回复 PROBE_OK，确认输出不夹带启动提示、更新通知等额外内容。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {!agent.purity ? (
            <p className="text-muted-foreground">尚未检查</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={agent.purity.passed ? "default" : "destructive"}>{agent.purity.passed ? "通过" : "未通过"}</Badge>
                {!agent.purity_current && <Badge variant="outline">配置修改后需重新检查</Badge>}
                <span className="text-xs text-muted-foreground">{formatTime(agent.purity.checked_at)}</span>
              </div>
              <pre className="max-h-40 overflow-y-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap">{agent.purity.received_text || "（没有输出）"}</pre>
              {agent.purity.error && <p className="text-destructive">{agent.purity.error}</p>}
            </>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>检测结果</CardTitle>
          <CardDescription>
            {agent.probe
              ? `${agent.probe.agent_name ?? "未报告名称"} ${agent.probe.agent_version ?? ""} · ACP 协议 v${agent.probe.protocol_version} · ${formatTime(agent.probe.probed_at)}`
              : "尚未检测"}
          </CardDescription>
        </CardHeader>
        {agent.probe && (
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>配置项</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead>当前值</TableHead>
                  <TableHead>可选数量</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agent.probe.config_options.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono text-xs">{o.id}</TableCell>
                    <TableCell>{o.name}</TableCell>
                    <TableCell className="max-w-64 truncate font-mono text-xs">{o.current_value ?? "—"}</TableCell>
                    <TableCell>{o.values.length}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        )}
      </Card>


      <AgentFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        agent={agent}
        onSaved={(a) => {
          update(a)
          setEditOpen(false)
        }}
      />
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除“{agent.name}”？</AlertDialogTitle>
            <AlertDialogDescription>已有运行记录中的配置快照不受影响，仍可查看。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => remove.mutate()}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
