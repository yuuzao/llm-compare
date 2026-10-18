import type { LibraryItemView, ProjectView } from "@llm-compare/shared"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useNavigate } from "react-router"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { LibraryPicker } from "@/components/library/library-picker"
import { api, errorMessage } from "@/lib/api"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: LibraryItemView
}
export function NewProjectDialog(props: Props) {
  return props.open ? <ProjectForm {...props} /> : null
}
function ProjectForm({ open, onOpenChange, initial }: Props) {
  const [title, setTitle] = useState(initial?.title ?? "")
  const [material, setMaterial] = useState<LibraryItemView | null>(
    initial?.kind === "material" ? initial : null
  )
  const [prompt, setPrompt] = useState<LibraryItemView | null>(
    initial?.kind === "prompt" ? initial : null
  )
  const [picker, setPicker] = useState<"material" | "prompt" | null>(null)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const create = useMutation({
    mutationFn: () =>
      api.post<ProjectView>("/projects", {
        title: title.trim(),
        ...(material
          ? { material_ref: { id: material.id, version: material.version } }
          : {}),
        ...(prompt
          ? { prompt_ref: { id: prompt.id, version: prompt.version } }
          : {}),
      }),
    onSuccess: (p) => {
      qc.setQueryData(["project", p.id], p)
      void qc.invalidateQueries({ queryKey: ["projects"] })
      onOpenChange(false)
      void navigate(`/projects/${p.id}`)
    },
  })
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!create.isPending) onOpenChange(v)
      }}
    >
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
        <form
          className="flex min-w-0 flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (title.trim() && !create.isPending) create.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
            <DialogDescription>
              可从内容库选择素材与提示词。创建后选择对比对象再运行。
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="project-title">项目名称</FieldLabel>
              <Input
                id="project-title"
                autoFocus
                maxLength={120}
                value={title}
                disabled={create.isPending}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            {(["material", "prompt"] as const).map((kind) => {
              const label = kind === "material" ? "素材" : "提示词"
              const selected = kind === "material" ? material : prompt
              return (
                <Field key={kind}>
                  <FieldLabel>{label}（可选）</FieldLabel>
                  <div className="flex min-w-0 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="min-w-0 flex-1 justify-start"
                      aria-label={`选择已保存${label}`}
                      disabled={create.isPending}
                      onClick={() => setPicker(kind)}
                    >
                      <span className="truncate">
                        {selected?.title ?? `选择已保存${label}`}
                      </span>
                    </Button>
                    {selected && (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={create.isPending}
                        aria-label={`清除已选${label}`}
                        onClick={() =>
                          kind === "material"
                            ? setMaterial(null)
                            : setPrompt(null)
                        }
                      >
                        ×
                      </Button>
                    )}
                  </div>
                  {selected && (
                    <div className="rounded-lg bg-muted/50 p-2 text-xs">
                      <p className="line-clamp-3 break-words whitespace-pre-wrap">
                        {selected.content || "（仅附件）"}
                      </p>
                      {selected.attachments.length > 0 && (
                        <p className="mt-1 text-muted-foreground">
                          {selected.attachments.length} 个附件，将一并复制
                        </p>
                      )}
                    </div>
                  )}
                </Field>
              )
            })}
            {create.isError && (
              <FieldError>{errorMessage(create.error)}</FieldError>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={!title.trim() || create.isPending}>
              {create.isPending && <Spinner />}创建
            </Button>
          </DialogFooter>
        </form>
        {picker && (
          <LibraryPicker
            open
            kind={picker}
            onOpenChange={(v) => {
              if (!v) setPicker(null)
            }}
            onSelect={(item) => {
              if (item.kind === "material") setMaterial(item)
              else setPrompt(item)
              setPicker(null)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
