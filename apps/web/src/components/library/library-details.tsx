import type { LibraryItemView } from "@llm-compare/shared"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AttachmentList } from "@/components/project/attachment-editor"
import { libraryFileUrl } from "@/components/library/library-picker"
import { formatTime } from "@/lib/format"

export function LibraryDetails({
  item,
  onClose,
  onUse,
  onEdit,
  onRestore,
  restoring,
}: {
  item: LibraryItemView
  onClose: () => void
  onUse: () => void
  onEdit: () => void
  onRestore: () => void
  restoring: boolean
}) {
  const label = item.kind === "material" ? "素材" : "提示词"
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="flex max-h-[85svh] w-[calc(100%-2rem)] flex-col sm:max-w-2xl">
        <DialogHeader className="min-w-0 shrink-0 pr-6">
          <DialogTitle className="leading-6 [overflow-wrap:anywhere] break-words">
            {item.title}
          </DialogTitle>
          <DialogDescription>
            {label} · 版本 {item.version} · {formatTime(item.updated_at)}
            {item.deleted ? " · 已移入回收站" : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto">
          <p className="text-sm [overflow-wrap:anywhere] break-words whitespace-pre-wrap">
            {item.content || "（仅附件）"}
          </p>
          <AttachmentList
            files={item.attachments}
            contentUrl={libraryFileUrl}
          />
        </div>
        <DialogFooter className="shrink-0">
          {item.deleted ? (
            <Button disabled={restoring} onClick={onRestore}>
              {restoring ? "正在恢复…" : "恢复"}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={onEdit}>
                编辑
              </Button>
              <Button onClick={onUse}>使用</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
