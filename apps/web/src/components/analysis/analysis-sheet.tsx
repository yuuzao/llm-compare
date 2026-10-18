import type { ConversationView } from "@llm-compare/shared"
import { MessageSquareTextIcon, PlusIcon } from "lucide-react"
import { useState } from "react"
import { ConversationPanel } from "@/components/analysis/conversation-panel"
import { NewConversationForm } from "@/components/analysis/new-conversation-form"
import { EmptyState, ErrorState, LoadingRows } from "@/components/common/states"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { formatTime } from "@/lib/format"
import { useConversations } from "@/lib/queries"

type Props = { projectId: string; open: boolean; onOpenChange: (open: boolean) => void; suggestedRunId: string | null }

export function AnalysisSheet({ projectId, open, onOpenChange, suggestedRunId }: Props) {
  const conversations = useConversations(projectId)
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const list = conversations.data ?? []
  const current: ConversationView | null = list.find((c) => c.id === selected) ?? (creating ? null : (list[0] ?? null))

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>按需分析</SheetTitle>
          <SheetDescription>Agent 只读取关联记录的快照，只在你发言后执行。</SheetDescription>
        </SheetHeader>
        <div className="flex items-center gap-2 px-4 pb-3">
          {list.length > 0 && !creating && (
            <Select value={current?.id ?? ""} onValueChange={setSelected}>
              <SelectTrigger className="min-w-0 flex-1" aria-label="选择分析会话">
                <SelectValue placeholder="选择分析会话" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {list.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.agent_config_name}
                      {c.model ? ` · ${c.model}` : ""} · {formatTime(c.updated_at)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
          {!creating && (
            <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
              <PlusIcon data-icon="inline-start" />
              新会话
            </Button>
          )}
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
          {conversations.isPending ? (
            <LoadingRows rows={3} />
          ) : conversations.isError ? (
            <ErrorState title="分析会话加载失败" error={conversations.error} onRetry={() => void conversations.refetch()} />
          ) : creating ? (
            <NewConversationForm
              projectId={projectId}
              suggestedRunId={suggestedRunId}
              onCancel={list.length > 0 ? () => setCreating(false) : undefined}
              onCreated={(c) => {
                setCreating(false)
                setSelected(c.id)
              }}
            />
          ) : current ? (
            <ConversationPanel key={current.id} conversation={current} />
          ) : (
            <EmptyState title="还没有分析会话" description="新建会话后选择 Agent 与要关联的对比记录。" icon={MessageSquareTextIcon}>
              <Button onClick={() => setCreating(true)}>新建分析会话</Button>
            </EmptyState>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
