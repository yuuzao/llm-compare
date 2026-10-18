import type { LibraryAppliedView } from "@llm-compare/shared"
import { useMutation } from "@tanstack/react-query"
import { BookmarkPlusIcon, LibraryBigIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import type { useDraft } from "@/hooks/use-draft"
import { api, errorMessage } from "@/lib/api"
import { LibraryPicker } from "./library-picker"
import { LibraryEditor, type LibrarySeed } from "./library-editor"

export function DraftLibraryActions({
  kind,
  projectId,
  draft,
  disabled,
}: {
  kind: "material" | "prompt"
  projectId: string
  draft: ReturnType<typeof useDraft>
  disabled: boolean
}) {
  const [choosing, setChoosing] = useState(false)
  const [seed, setSeed] = useState<LibrarySeed | null>(null)
  const label = kind === "material" ? "素材" : "提示词"
  const source = draft.sources[kind]
  const apply = useMutation({
    mutationFn: (ref: { id: string; version: number }) =>
      api.post<LibraryAppliedView>(
        `/projects/${projectId}/library-content`,
        ref
      ),
    onSuccess: (content) => {
      draft.applyLibrary(content)
      setChoosing(false)
      toast.success(`${label}已载入，可继续编辑`)
    },
  })
  return (
    <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1">
      {source && (
        <span
          className="min-w-0 truncate text-xs text-muted-foreground"
          title={`来自内容库：${source.title}（版本 ${source.version}），修改不回写原条目`}
        >
          {source.title}
        </span>
      )}
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={`从库中选择${label}`}
        title={`从库中选择${label}`}
        disabled={disabled || apply.isPending}
        onClick={() => {
          apply.reset()
          setChoosing(true)
        }}
      >
        <LibraryBigIcon />
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={`保存${label}到库`}
        title={`保存${label}到库`}
        disabled={
          disabled ||
          apply.isPending ||
          (kind === "material"
            ? !draft.material.trim() && !draft.attachments.length
            : !draft.prompt.trim())
        }
        onClick={() =>
          setSeed({
            projectId,
            content: kind === "material" ? draft.material : draft.prompt,
            attachments: kind === "material" ? [...draft.attachments] : [],
          })
        }
      >
        <BookmarkPlusIcon />
      </Button>
      <LibraryPicker
        open={choosing}
        kind={kind}
        replace
        busy={apply.isPending}
        error={apply.isError ? errorMessage(apply.error) : undefined}
        onOpenChange={setChoosing}
        onSelect={(item) => {
          apply.mutate({ id: item.id, version: item.version })
        }}
      />
      {seed && (
        <LibraryEditor
          open
          kind={kind}
          seed={seed}
          onOpenChange={(v) => {
            if (!v) setSeed(null)
          }}
        />
      )}
    </div>
  )
}
