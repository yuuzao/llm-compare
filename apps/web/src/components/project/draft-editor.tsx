import { DraftLibraryActions } from "@/components/library/draft-library-actions"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { AttachmentEditor } from "@/components/project/attachment-editor"
import { useState } from "react"
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import type { useDraft } from "@/hooks/use-draft"

const STATUS_TEXT = {
  saved: "草稿已保存",
  pending: "有未保存的修改",
  saving: "正在保存",
  error: "保存失败，稍后自动重试",
  conflict: "草稿已在别处修改",
} as const

export function DraftStatus({ draft }: { draft: ReturnType<typeof useDraft> }) {
  return (
    <div
      className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground"
      role="status"
    >
      {draft.status === "saving" && <Spinner />}
      <Badge
        variant={
          draft.status === "error" || draft.status === "conflict"
            ? "destructive"
            : "outline"
        }
      >
        {STATUS_TEXT[draft.status]}
      </Badge>
    </div>
  )
}

export function DraftEditor({
  draft,
  projectId,
  onBusy,
}: {
  draft: ReturnType<typeof useDraft>
  projectId: string
  onBusy: (busy: boolean) => void
}) {
  const [materialOpen, setMaterialOpen] = useState(true)
  const [uploadBusy, setUploadBusy] = useState(false)
  const materialChars = [...draft.material].length

  return (
    <FieldGroup className="@container/input gap-3">
      {draft.status === "conflict" && (
        <Alert variant="destructive">
          <AlertTitle>草稿版本冲突</AlertTitle>
          <AlertDescription>
            {draft.errorMessage}
            。当前编辑内容仍保留在输入框中，可先复制再载入最新草稿。
          </AlertDescription>
          <AlertAction>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void draft.reloadFromServer()}
            >
              载入最新草稿
            </Button>
          </AlertAction>
        </Alert>
      )}
      {draft.status === "error" && draft.errorMessage && (
        <Alert variant="destructive">
          <AlertTitle>草稿保存失败</AlertTitle>
          <AlertDescription>{draft.errorMessage}</AlertDescription>
        </Alert>
      )}
      <div className="grid min-w-0 items-stretch gap-3 @sm/input:grid-cols-2">
        <Field className="min-w-0 gap-2">
          <div className="flex items-center gap-2">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={materialOpen ? "折叠素材" : "展开素材"}
              onClick={() => setMaterialOpen((o) => !o)}
            >
              {materialOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
            </Button>
            <FieldLabel className="shrink-0" htmlFor="draft-material">
              素材
            </FieldLabel>
            <span className="shrink-0 text-xs text-muted-foreground">
              {materialChars > 0
                ? `${materialChars.toLocaleString("zh-CN")} 字`
                : "可留空"}
            </span>
            <DraftLibraryActions
              kind="material"
              projectId={projectId}
              draft={draft}
              disabled={uploadBusy}
            />
          </div>
          {materialOpen && (
            <div className="flex min-h-32 min-w-0 flex-auto resize-y flex-col overflow-hidden rounded-lg border border-input focus-within:ring-2 focus-within:ring-ring/40">
              <Textarea
                id="draft-material"
                className="field-sizing-fixed h-20 min-h-20 flex-1 resize-none rounded-none border-0 font-mono text-xs shadow-none focus-visible:ring-0"
                placeholder="粘贴需要模型参考的文字，也可以添加文件"
                value={draft.material}
                onChange={(e) => draft.setMaterial(e.target.value)}
              />
              <AttachmentEditor
                projectId={projectId}
                files={draft.attachments}
                onChange={draft.setAttachments}
                onBusy={(busy) => {
                  setUploadBusy(busy)
                  onBusy(busy)
                }}
              />
            </div>
          )}
        </Field>
        <Field className="min-w-0 gap-2">
          <div className="flex h-6 items-center gap-2">
            <FieldLabel className="shrink-0" htmlFor="draft-prompt">
              提示词
            </FieldLabel>
            <DraftLibraryActions
              kind="prompt"
              projectId={projectId}
              draft={draft}
              disabled={uploadBusy}
            />
          </div>
          <Textarea
            id="draft-prompt"
            className="field-sizing-fixed h-32 min-h-32 flex-auto resize-y"
            placeholder="希望 Agent 如何处理素材"
            value={draft.prompt}
            onChange={(e) => draft.setPrompt(e.target.value)}
          />
        </Field>
      </div>
    </FieldGroup>
  )
}
