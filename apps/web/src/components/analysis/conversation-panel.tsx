import type { ConversationView, MessageView, SendMessageResult, StreamEvent } from "@llm-compare/shared"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { SendIcon, Settings2Icon, SquareIcon } from "lucide-react"
import { useCallback, useLayoutEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { RunScopePicker } from "@/components/analysis/run-scope-picker"
import { CopyButton } from "@/components/common/copy-button"
import { Markdown } from "@/components/common/markdown"
import { ErrorState, LoadingRows } from "@/components/common/states"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useEventStream } from "@/hooks/use-event-stream"
import { api, errorMessage } from "@/lib/api"
import { formatMs, formatTokens } from "@/lib/format"
import { keys, useMessages } from "@/lib/queries"

const STATUS_TEXT: Record<MessageView["status"], string> = {
  generating: "生成中",
  succeeded: "完成",
  failed: "失败",
  cancelled: "已停止",
  interrupted: "已中断",
}

type LiveText = Record<string, { seq: number; text: string }>

export function ConversationPanel({ conversation }: { conversation: ConversationView }) {
  const qc = useQueryClient()
  const messages = useMessages(conversation.id)
  const [live, setLive] = useState<LiveText>({})
  const [draft, setDraft] = useState("")
  const [scope, setScope] = useState(conversation.scope.run_ids)
  const listRef = useRef<HTMLDivElement>(null)

  const onEvent = useCallback(
    (e: StreamEvent) => {
      const mid = e.message_id
      if (mid === null) return
      if (e.type === "output_chunk") {
        const text = (e.payload as { text: string }).text
        setLive((prev) => {
          const cur = prev[mid]
          if (cur && e.seq <= cur.seq) return prev
          return { ...prev, [mid]: { seq: e.seq, text: (cur?.text ?? "") + text } }
        })
      } else if (e.type === "message_update") {
        const m = e.payload as MessageView
        qc.setQueryData<MessageView[]>(keys.messages(conversation.id), (prev) => {
          if (!prev) return prev
          return prev.some((x) => x.id === m.id) ? prev.map((x) => (x.id === m.id ? m : x)) : [...prev, m]
        })
        void qc.invalidateQueries({ queryKey: keys.conversations(conversation.project_id) })
      }
    },
    [qc, conversation.id, conversation.project_id],
  )
  useEventStream(`/conversations/${conversation.id}/stream`, 0, onEvent)

  const items = messages.data ?? []
  const generating = items.some((m) => m.status === "generating")
  const lastLen = items.length + Object.values(live).reduce((n, l) => n + l.text.length, 0)

  useLayoutEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lastLen])

  const send = useMutation({
    mutationFn: (content: string) => api.post<SendMessageResult>(`/conversations/${conversation.id}/messages`, { content }),
    onSuccess: (created) => {
      setDraft("")
      qc.setQueryData<MessageView[]>(keys.messages(conversation.id), (prev) => {
        const base = prev ?? []
        // SSE 可能先于 POST 响应到达。保留已有回复状态，并把用户消息排在回复前。
        const prior = base.filter((m) => m.id !== created.user.id && m.id !== created.assistant.id)
        return [...prior, base.find((m) => m.id === created.user.id) ?? created.user, base.find((m) => m.id === created.assistant.id) ?? created.assistant]
      })
    },
  })
  const cancel = useMutation({
    mutationFn: () => api.post(`/conversations/${conversation.id}/cancel`),
    onError: (e) => toast.error(`停止失败：${errorMessage(e)}`),
  })
  const saveScope = useMutation({
    mutationFn: () => api.patch<ConversationView>(`/conversations/${conversation.id}`, { scope: { run_ids: scope } }),
    onSuccess: () => {
      toast.success("关联记录已更新，下一条消息起生效")
      void qc.invalidateQueries({ queryKey: keys.conversations(conversation.project_id) })
    },
    onError: (e) => toast.error(`更新失败：${errorMessage(e)}`),
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Badge variant="secondary">{conversation.agent_config_name}</Badge>
        {conversation.model && <Badge variant="outline">{conversation.model}</Badge>}
        <Badge variant="outline">思考强度 {conversation.thought_level_name ?? "未设置"}</Badge>
        <span className="text-muted-foreground">关联 {conversation.scope.runs.map((r) => `第 ${r.run_number} 轮`).join("、")}</span>
      </div>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button size="xs" variant="ghost">
            <Settings2Icon data-icon="inline-start" />
            调整关联记录
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-2 rounded-md border p-3">
          <RunScopePicker projectId={conversation.project_id} value={scope} onChange={setScope} />
          <Button size="sm" className="self-end" disabled={scope.length === 0 || saveScope.isPending} onClick={() => saveScope.mutate()}>
            保存关联
          </Button>
        </CollapsibleContent>
      </Collapsible>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto rounded-md border p-3">
        {messages.isPending ? (
          <LoadingRows rows={3} />
        ) : messages.isError ? (
          <ErrorState title="消息加载失败" error={messages.error} onRetry={() => void messages.refetch()} />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">输入分析要求后发送，Agent 才会开始读取关联记录。</p>
        ) : (
          <div className="flex flex-col gap-4">
            {items.map((m) => (
              <MessageBubble key={m.id} message={m} liveText={live[m.id]?.text} />
            ))}
          </div>
        )}
      </div>
      {send.isError && (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(send.error)}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col gap-2">
        <Textarea
          aria-label="分析要求"
          placeholder="例如：对比两份回答在事实准确性上的差异"
          className="max-h-40 min-h-20"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && draft.trim() && !generating && !send.isPending) {
              e.preventDefault()
              send.mutate(draft)
            }
          }}
        />
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-muted-foreground">Ctrl + Enter 发送</span>
          {generating && (
            <Button size="sm" variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              <SquareIcon data-icon="inline-start" />
              停止
            </Button>
          )}
          <Button size="sm" disabled={!draft.trim() || generating || send.isPending} onClick={() => send.mutate(draft)}>
            {send.isPending ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
            发送
          </Button>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ message, liveText }: { message: MessageView; liveText: string | undefined }) {
  const text = message.status === "generating" ? (liveText ?? message.content) : message.content
  if (message.role === "user") {
    return <div className="self-end rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap">{message.content}</div>
  }
  const deleted = message.sources.filter((s) => s.source_deleted)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Badge variant={message.status === "failed" || message.status === "interrupted" ? "destructive" : "outline"}>{STATUS_TEXT[message.status]}</Badge>
        {message.readonly_check === "failed" && <Badge variant="destructive">只读检查未通过</Badge>}
        {message.timing?.total_ms != null && <span>耗时 {formatMs(message.timing.total_ms)}</span>}
        {message.usage && (
          <span>{message.usage.prompt_usage_reported ? `输入 ${formatTokens(message.usage.input_tokens)} · 输出 ${formatTokens(message.usage.output_tokens)}` : "用量未上报"}</span>
        )}
        {deleted.length > 0 && <Badge variant="destructive">{deleted.length} 个来源已永久删除</Badge>}
      </div>
      {text ? <Markdown text={text} /> : message.status === "generating" ? <Spinner /> : null}
      {message.error && <p className="text-xs text-destructive">{message.error}</p>}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">引用来源（{message.sources.length}）</summary>
        <ul className="mt-1 flex flex-col gap-0.5 pl-4">
          {message.sources.map((s) => (
            <li key={s.attempt_id}>
              第 {s.run_number} 轮 · {s.target_label} · 第 {s.attempt_seq} 次{s.complete ? "" : "（未完成时的输出）"}
              {s.source_deleted && "（来源已永久删除）"}
            </li>
          ))}
        </ul>
      </details>
      {message.status !== "generating" && text && (
        <div>
          <CopyButton text={text} />
        </div>
      )}
    </div>
  )
}
