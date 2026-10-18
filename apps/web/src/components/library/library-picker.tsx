import type { LibraryItemView } from "@llm-compare/shared"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { AttachmentList } from "@/components/project/attachment-editor"
import { ErrorState, LoadingRows, EmptyState } from "@/components/common/states"
import { useDebounced } from "@/hooks/use-debounced"
import { useLibrary } from "./queries"

export const libraryFileUrl = (id: string) =>
  `/api/v1/library-attachments/${id}/content`
export function LibraryPicker(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: "material" | "prompt"
  onSelect: (item: LibraryItemView) => void | Promise<void>
  busy?: boolean
  error?: string
  replace?: boolean
}) {
  return props.open ? <Picker {...props} /> : null
}
function Picker({
  open,
  onOpenChange,
  kind,
  onSelect,
  busy,
  error,
  replace,
}: Parameters<typeof LibraryPicker>[0]) {
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const items = useLibrary(kind, useDebounced(search, 250))
  const label = kind === "material" ? "素材" : "提示词"
  const all = items.data?.pages.flatMap((p) => p.items) ?? []
  const selected = all.find((item) => item.id === selectedId)
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value)
      }}
    >
      <DialogContent className="max-h-[85svh] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>选择已保存{label}</DialogTitle>
          <DialogDescription>
            {replace
              ? `载入将替换当前${label}${kind === "material" ? "和附件" : ""}，另一项保持不变。`
              : "选择后复制到新项目，可继续编辑。"}
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            aria-label={`搜索已保存${label}`}
            placeholder="按名称或正文搜索"
            value={search}
            disabled={busy}
            onChange={(e) => {
              setSearch(e.target.value)
              setSelectedId(null)
            }}
          />
          <Button
            variant="outline"
            disabled={busy || items.isFetching}
            onClick={() => {
              setSelectedId(null)
              void items.refetch()
            }}
          >
            刷新列表
          </Button>
        </div>
        {items.isPending ? (
          <LoadingRows rows={3} />
        ) : items.isError ? (
          <ErrorState
            error={items.error}
            onRetry={() => void items.refetch()}
          />
        ) : (
          <div className="grid min-h-0 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="flex max-h-80 min-w-0 flex-col gap-2 overflow-y-auto">
              {all.length === 0 && (
                <EmptyState
                  title="没有匹配的内容"
                  description="可先到内容库保存常用内容。"
                />
              )}
              {all.map((item) => (
                <button
                  type="button"
                  aria-label={item.title}
                  key={item.id}
                  aria-pressed={selected?.id === item.id}
                  className={`rounded-lg border p-3 text-left hover:bg-muted ${selected?.id === item.id ? "border-primary bg-muted" : ""}`}
                  disabled={busy || items.isFetching}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="block truncate font-medium">
                    {item.title}
                  </span>
                  <span className="mt-1 line-clamp-2 block text-xs whitespace-pre-wrap text-muted-foreground">
                    {item.content || `${item.attachments.length} 个附件`}
                  </span>
                </button>
              ))}
              {items.hasNextPage && (
                <Button
                  variant="outline"
                  disabled={items.isFetchingNextPage}
                  onClick={() => void items.fetchNextPage()}
                >
                  加载更多
                </Button>
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-3 rounded-lg border p-3">
              {selected ? (
                <>
                  <p className="font-medium break-words">{selected.title}</p>
                  <pre className="max-h-52 overflow-y-auto text-sm break-words whitespace-pre-wrap">
                    {selected.content || "（仅附件）"}
                  </pre>
                  <AttachmentList
                    files={selected.attachments}
                    contentUrl={libraryFileUrl}
                  />
                  <Button
                    disabled={busy || items.isFetching}
                    onClick={() => void onSelect(selected)}
                  >
                    {busy ? "正在载入…" : replace ? "载入并替换" : "选择此内容"}
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  选择左侧条目预览正文和附件。
                </p>
              )}
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
