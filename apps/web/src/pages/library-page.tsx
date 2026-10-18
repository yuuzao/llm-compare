import type { LibraryItemView } from "@llm-compare/shared"
import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useSearchParams } from "react-router"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog"
import { ErrorState, EmptyState, LoadingRows } from "@/components/common/states"
import { NewProjectDialog } from "@/components/project/new-project-dialog"
import { LibraryEditor } from "@/components/library/library-editor"
import { LibraryDetails } from "@/components/library/library-details"
import { useLibrary, libraryKey } from "@/components/library/queries"
import { useDebounced } from "@/hooks/use-debounced"
import { api, errorMessage } from "@/lib/api"
import { formatTime } from "@/lib/format"

export function LibraryPage() {
  const [params, setParams] = useSearchParams()
  const kind = params.get("kind") === "prompt" ? "prompt" : "material"
  const label = kind === "material" ? "素材" : "提示词"
  const [search, setSearch] = useState("")
  const [recycle, setRecycle] = useState(false)
  const list = useLibrary(kind, useDebounced(search, 250), recycle)
  const [editor, setEditor] = useState<{ item?: LibraryItemView } | null>(null)
  const [useItem, setUseItem] = useState<LibraryItemView | null>(null)
  const [details, setDetails] = useState<LibraryItemView | null>(null)
  const [deleting, setDeleting] = useState<LibraryItemView | null>(null)
  const qc = useQueryClient()
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/library-items/${id}`),
    onSuccess: () => {
      setDeleting(null)
      toast.success("已移入内容库回收站")
      void qc.invalidateQueries({ queryKey: libraryKey })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const restore = useMutation({
    mutationFn: (id: string) => api.post(`/library-items/${id}/restore`),
    onSuccess: () => {
      toast.success("条目已恢复")
      void qc.invalidateQueries({ queryKey: libraryKey })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <div className="@container/library flex h-full min-w-0 flex-col gap-4 overflow-y-auto p-4">
      <div>
        <h1 className="text-lg font-semibold">内容库</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          保存常用素材、附件和提示词，选择后复制到项目，各自独立编辑。
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={kind}
          onValueChange={(value) => {
            setParams({ kind: value })
            setSearch("")
          }}
        >
          <TabsList>
            <TabsTrigger value="material">素材</TabsTrigger>
            <TabsTrigger value="prompt">提示词</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button onClick={() => setEditor({})}>新建{label}</Button>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={recycle}
            onCheckedChange={(v) => setRecycle(v === true)}
          />
          显示内容库回收站
        </label>
      </div>
      <Input
        className="max-w-lg"
        aria-label="搜索内容库"
        placeholder="搜索名称或正文"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {list.isPending ? (
        <LoadingRows rows={4} />
      ) : list.isError ? (
        <ErrorState
          title="内容库加载失败"
          error={list.error}
          onRetry={() => void list.refetch()}
        />
      ) : !items.length ? (
        <EmptyState
          title={`还没有匹配的${label}`}
          description={`点击“新建${label}”，也可以从项目输入框保存到库。`}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 @sm/library:grid-cols-2 @2xl/library:grid-cols-3 @5xl/library:grid-cols-5">
          {items.map((item) => (
            <section
              key={item.id}
              aria-label={`内容库条目 ${item.title}`}
              className="flex min-w-0 flex-col overflow-hidden rounded-xl border"
            >
              <button
                type="button"
                aria-label={`查看详情 ${item.title}`}
                onClick={() => setDetails(item)}
                className="flex min-w-0 flex-1 cursor-pointer flex-col gap-3 p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                <h2 className="w-full truncate font-medium" title={item.title}>
                  {item.title}
                </h2>
                <p className="line-clamp-3 min-h-15 w-full text-sm leading-5 [overflow-wrap:anywhere] break-words whitespace-pre-wrap text-muted-foreground">
                  {item.content || "（仅附件）"}
                </p>
                <p className="w-full truncate text-xs text-muted-foreground">
                  {item.attachments.length > 0
                    ? `${item.attachments.length} 个附件 · `
                    : ""}
                  版本 {item.version}
                  {item.deleted ? " · 回收站" : ""}
                </p>
                <p className="w-full truncate text-xs text-muted-foreground">
                  {formatTime(item.updated_at)}
                </p>
              </button>
              <div className="flex items-center gap-1 border-t px-3 py-2">
                {item.deleted ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={restore.isPending}
                    onClick={() => restore.mutate(item.id)}
                  >
                    恢复
                  </Button>
                ) : (
                  <>
                    <Button size="sm" onClick={() => setUseItem(item)}>
                      使用
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditor({ item })}
                    >
                      编辑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeleting(item)}
                    >
                      删除
                    </Button>
                  </>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
      {list.hasNextPage && (
        <Button
          variant="outline"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          加载更多
        </Button>
      )}
      {details && (
        <LibraryDetails
          item={details}
          onClose={() => setDetails(null)}
          onUse={() => {
            setDetails(null)
            setUseItem(details)
          }}
          onEdit={() => {
            setDetails(null)
            setEditor({ item: details })
          }}
          onRestore={() =>
            restore.mutate(details.id, {
              onSuccess: () => setDetails(null),
            })
          }
          restoring={restore.isPending}
        />
      )}
      {editor && (
        <LibraryEditor
          open
          onOpenChange={(open) => {
            if (!open) setEditor(null)
          }}
          kind={kind}
          item={editor.item}
        />
      )}
      {useItem && (
        <NewProjectDialog
          open
          initial={useItem}
          onOpenChange={(open) => {
            if (!open) setUseItem(null)
          }}
        />
      )}
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除“{deleting?.title}”？</AlertDialogTitle>
            <AlertDialogDescription>
              条目移入回收站。已创建的项目、附件副本和历史记录保持不变。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault()
                if (deleting) remove.mutate(deleting.id)
              }}
            >
              移入回收站
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
