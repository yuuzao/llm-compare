import type { AttachmentView, LibraryItemView } from "@llm-compare/shared"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { AttachmentList } from "@/components/project/attachment-editor"
import { api, errorMessage } from "@/lib/api"
import { libraryFileUrl } from "./library-picker"
import { libraryKey } from "./queries"

export type LibrarySeed = {
  content: string
  projectId: string
  attachments: AttachmentView[]
}
type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: "material" | "prompt"
  item?: LibraryItemView
  seed?: LibrarySeed
}
export function LibraryEditor(props: Props) {
  return props.open ? <Editor {...props} /> : null
}
function Editor({ open, onOpenChange, kind, item, seed }: Props) {
  const [title, setTitle] = useState(item?.title ?? "")
  const [content, setContent] = useState(item?.content ?? seed?.content ?? "")
  const [kept, setKept] = useState(item?.attachments ?? [])
  const [source, setSource] = useState(seed?.attachments ?? [])
  const [files, setFiles] = useState<File[]>([])
  const input = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()
  const label = kind === "material" ? "素材" : "提示词"
  const count = kept.length + source.length + files.length
  const save = useMutation({
    mutationFn: async () => {
      const form = new FormData()
      form.set(
        "data",
        JSON.stringify({
          kind,
          title: title.trim(),
          content,
          attachment_ids: kept.map((f) => f.id),
          ...(seed
            ? {
                source_project_id: seed.projectId,
                source_attachment_ids: source.map((f) => f.id),
              }
            : {}),
          ...(item ? { expected_version: item.version } : {}),
        })
      )
      files.forEach((f) => form.append("files", f))
      return item
        ? api.put<LibraryItemView>(`/library-items/${item.id}`, form)
        : api.post<LibraryItemView>("/library-items", form)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: libraryKey })
      toast.success(`${label}已保存到内容库`)
      onOpenChange(false)
    },
  })
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!save.isPending) onOpenChange(value)
      }}
    >
      <DialogContent className="max-h-[85svh] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-2xl">
        <form
          className="flex min-w-0 flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!save.isPending) save.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {item ? "编辑" : "保存"}
              {label}
            </DialogTitle>
            <DialogDescription>
              保存独立副本，已有项目和历史记录不会随之变化。
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="library-title">名称</FieldLabel>
            <Input
              id="library-title"
              autoFocus
              maxLength={120}
              value={title}
              disabled={save.isPending}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="library-content">{label}正文</FieldLabel>
            <Textarea
              id="library-content"
              className="field-sizing-fixed h-48 resize-y"
              value={content}
              disabled={save.isPending}
              onChange={(e) => setContent(e.target.value)}
            />
          </Field>
          {kind === "material" && (
            <div className="flex min-w-0 flex-col gap-2">
              <input
                ref={input}
                aria-label="内容库素材附件"
                className="sr-only"
                type="file"
                multiple
                disabled={save.isPending}
                accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.md,.csv,.tsv,.json,.jsonl,.yaml,.yml,.log,.xml"
                onChange={(e) => {
                  setFiles((prev) => [...prev, ...(e.target.files ?? [])])
                  e.target.value = ""
                }}
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={save.isPending || count >= 10}
                  onClick={() => input.current?.click()}
                >
                  添加附件
                </Button>
                <span className="text-xs text-muted-foreground">
                  {count}/10 · 图片、PDF、UTF-8 文本；保存时上传
                </span>
              </div>
              <AttachmentList
                files={kept}
                contentUrl={libraryFileUrl}
                onRemove={
                  save.isPending
                    ? undefined
                    : (id) => setKept((prev) => prev.filter((f) => f.id !== id))
                }
              />
              <AttachmentList
                files={source}
                onRemove={
                  save.isPending
                    ? undefined
                    : (id) =>
                        setSource((prev) => prev.filter((f) => f.id !== id))
                }
              />
              {files.map((f, i) => (
                <div
                  className="flex min-w-0 items-center gap-2 rounded border p-2 text-xs"
                  key={i}
                >
                  <span className="min-w-0 flex-1 truncate" title={f.name}>
                    {f.name}
                  </span>
                  <span>{Math.ceil(f.size / 1024)} KB</span>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`移除待上传附件 ${f.name}`}
                    disabled={save.isPending}
                    onClick={() =>
                      setFiles((prev) => prev.filter((_, n) => n !== i))
                    }
                  >
                    ×
                  </Button>
                </div>
              ))}
            </div>
          )}
          {save.isError && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(save.error)}
            </p>
          )}
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={
                save.isPending ||
                !title.trim() ||
                count > 10 ||
                (!content.trim() && (kind === "prompt" || !count))
              }
            >
              {save.isPending ? "正在保存…" : "保存"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
