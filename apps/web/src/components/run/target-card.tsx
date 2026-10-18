import { targetName } from "@llm-compare/shared"
import type { AttemptView, TargetView } from "@llm-compare/shared"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ArrowDownIcon, BrainIcon, Maximize2Icon, RotateCcwIcon, SquareIcon } from "lucide-react"
import { useLayoutEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { CopyButton } from "@/components/common/copy-button"
import { Markdown } from "@/components/common/markdown"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { useNow } from "@/hooks/use-now"
import { api, errorMessage } from "@/lib/api"
import { ATTEMPT_STATUS_LABEL, attemptVariant, formatMs, formatTokens, isTerminalAttempt } from "@/lib/format"
import { mergedText, type LiveAttempt } from "@/lib/live"
import { keys } from "@/lib/queries"

type Props = { runId: string; target: TargetView; live: Record<string, LiveAttempt>; readOnly: boolean }

export function targetLabel(t: TargetView): string {
  const s = t.snapshot
  return s.base_model ? `${targetName(s)} · ${s.base_model}` : targetName(s)
}

export function TargetCard({ runId, target, live, readOnly }: Props) {
  const qc = useQueryClient()
  const latest = target.attempts[target.attempts.length - 1]!
  const [picked, setPicked] = useState<string | null>(null)
  const attempt = target.attempts.find((a) => a.id === picked) ?? latest
  const isLatest = attempt.id === latest.id
  const active = !isTerminalAttempt(attempt.status)
  const liveState = live[attempt.id]
  const text = mergedText(attempt, liveState)
  const [expanded, setExpanded] = useState(false)

  const cancel = useMutation({
    mutationFn: () => api.post(`/runs/${runId}/attempts/${attempt.id}/cancel`),
    onError: (e) => toast.error(`停止失败：${errorMessage(e)}`),
  })
  const retry = useMutation({
    mutationFn: () => api.post<AttemptView>(`/runs/${runId}/targets/${target.id}/attempts`),
    onSuccess: () => {
      setPicked(null)
      void qc.invalidateQueries({ queryKey: keys.run(runId), exact: true })
    },
    onError: (e) => toast.error(`重试失败：${errorMessage(e)}`),
  })

  return (
    <Card className="flex h-full min-h-0 flex-col" size="sm">
      <CardHeader>
        <CardTitle className="truncate" title={targetLabel(target)}>{targetLabel(target)}</CardTitle>
        <CardDescription className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Badge variant={attemptVariant(attempt.status)}>{ATTEMPT_STATUS_LABEL[attempt.status]}</Badge>
          {(
            <Badge variant="outline" className="max-w-full" title={`思考 ${target.snapshot.thought_native_value}`}>
              <span className="min-w-0 truncate">思考 {target.snapshot.thought_level_name ?? "未设置"}</span>
            </Badge>
          )}
          {attempt.readonly_check === "failed" && <Badge variant="destructive">只读检查未通过</Badge>}
          {!isLatest && <Badge variant="outline">查看的是旧尝试</Badge>}
          <span className="flex-1" />
          {target.attempts.length > 1 ? (
            <Select value={attempt.id} onValueChange={setPicked}>
              <SelectTrigger size="sm" aria-label="切换尝试">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {target.attempts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      第 {a.seq} 次 · {ATTEMPT_STATUS_LABEL[a.status]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : (
            <span className="text-xs text-muted-foreground">第 1 次</span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-2">
        <Metrics attempt={attempt} live={liveState} />
        {liveState && liveState.thoughts.length > 0 && <Thoughts text={liveState.thoughts} />}
        <OutputPane text={text} active={active} />
        {attempt.error && (
          <Alert variant="destructive">
            <AlertTitle>{attempt.status === "cancelled" ? "已停止" : "执行出错"}</AlertTitle>
            <AlertDescription className="break-words whitespace-pre-wrap">{attempt.error}</AlertDescription>
          </Alert>
        )}
        {attempt.readonly_check === "failed" && attempt.readonly_check_detail && (
          <Alert variant="destructive">
            <AlertTitle>工作目录被改动</AlertTitle>
            <AlertDescription>{attempt.readonly_check_detail}</AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-1">
        <CopyButton text={text} />
        <Button size="sm" variant="ghost" disabled={text.length === 0} onClick={() => setExpanded(true)}>
          <Maximize2Icon data-icon="inline-start" />
          展开
        </Button>
        <div className="flex-1" />
        {!readOnly && isLatest && active && (
          <Button size="sm" variant="outline" disabled={attempt.status === "cancel_requested" || cancel.isPending} onClick={() => cancel.mutate()}>
            {attempt.status === "cancel_requested" ? <Spinner data-icon="inline-start" /> : <SquareIcon data-icon="inline-start" />}
            {attempt.status === "cancel_requested" ? "正在停止" : "停止"}
          </Button>
        )}
        {!readOnly && isLatest && !active && (
          <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate()}>
            {retry.isPending ? <Spinner data-icon="inline-start" /> : <RotateCcwIcon data-icon="inline-start" />}
            重试
          </Button>
        )}
      </CardFooter>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="flex max-h-[90svh] flex-col sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {targetLabel(target)} · 第 {attempt.seq} 次
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="min-h-0 flex-1 pr-3">
            <Markdown text={text} />
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function Metrics({ attempt, live }: { attempt: AttemptView; live: LiveAttempt | undefined }) {
  const active = !isTerminalAttempt(attempt.status)
  const now = useNow(active)
  const t = attempt.timing
  const u = attempt.usage
  const elapsed = active ? now - Date.parse(attempt.created_at) : t.total_ms
  const contextUsed = u.context_used ?? live?.contextUsed ?? null
  const contextSize = u.context_size ?? live?.contextSize ?? null
  const tokens = u.prompt_usage_reported
    ? `输入 ${formatTokens(u.input_tokens)} · 输出 ${formatTokens(u.output_tokens)}${u.thought_tokens ? ` · 思考 ${formatTokens(u.thought_tokens)}` : ""}`
    : active
      ? "用量待上报"
      : "用量未上报"
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      <dt>耗时</dt>
      <dd className="text-foreground tabular-nums">
        {active ? `已用 ${formatMs(elapsed)}` : `总计 ${formatMs(t.total_ms)} · 启动 ${formatMs(t.startup_ms)} · 首字 ${formatMs(t.ttft_ms)} · 生成 ${formatMs(t.generation_ms)}`}
      </dd>
      <dt>用量</dt>
      <dd className="text-foreground tabular-nums">{tokens}</dd>
      {contextUsed !== null && contextSize !== null && (
        <>
          <dt>上下文</dt>
          <dd className="text-foreground tabular-nums">
            {formatTokens(contextUsed)} / {formatTokens(contextSize)}
          </dd>
        </>
      )}
      {attempt.usage.cost_amount !== null && (
        <>
          <dt>费用</dt>
          <dd className="text-foreground tabular-nums">
            {attempt.usage.cost_amount} {attempt.usage.cost_currency}
          </dd>
        </>
      )}
      {live && live.toolCalls > 0 && (
        <>
          <dt>工具调用</dt>
          <dd className="text-foreground">{live.toolCalls} 次（只读）</dd>
        </>
      )}
    </dl>
  )
}

function Thoughts({ text }: { text: string }) {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button size="xs" variant="ghost" className="self-start">
          <BrainIcon data-icon="inline-start" />
          思考过程（{[...text].length} 字）
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="max-h-40 overflow-y-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap text-muted-foreground">{text}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function OutputPane({ text, active }: { text: string; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)

  useLayoutEffect(() => {
    const el = ref.current
    if (el && follow) el.scrollTop = el.scrollHeight
  }, [text, follow])

  return (
    <div className="relative min-h-48 flex-1">
      <div
        ref={ref}
        className="absolute inset-0 overflow-y-auto rounded-md border p-3"
        onScroll={(e) => {
          const el = e.currentTarget
          setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 24)
        }}
      >
        {text.length > 0 ? (
          <Markdown text={text} />
        ) : (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            {active ? (
              <>
                <Spinner />
                等待输出
              </>
            ) : (
              "没有输出"
            )}
          </div>
        )}
      </div>
      {!follow && active && (
        <Button size="xs" variant="secondary" className="absolute right-3 bottom-3" onClick={() => setFollow(true)}>
          <ArrowDownIcon data-icon="inline-start" />
          回到最新
        </Button>
      )}
    </div>
  )
}
