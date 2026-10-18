import type {
  AttachmentView,
  ProjectView,
  LibrarySources,
  LibraryAppliedView,
} from "@llm-compare/shared"
import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useRef, useState } from "react"
import { api, ApiRequestError, errorMessage } from "@/lib/api"
import { keys } from "@/lib/queries"

export type DraftStatus = "saved" | "pending" | "saving" | "error" | "conflict"

type Values = {
  material: string
  prompt: string
  attachments: AttachmentView[]
  sources: LibrarySources
}

export function useDraft(project: ProjectView) {
  const qc = useQueryClient()
  const [values, setValues] = useState<Values>({
    material: project.draft_material,
    prompt: project.draft_prompt,
    attachments: project.draft_attachments,
    sources: project.draft_sources ?? {},
  })
  const [saved, setSaved] = useState<Values>(values)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<{
    message: string
    conflict: boolean
  } | null>(null)
  const version = useRef(project.draft_version)
  const latest = useRef(values)

  useEffect(() => {
    latest.current = values
  }, [values])

  const save = useCallback(async () => {
    const sending = latest.current
    setSaving(true)
    try {
      const p = await api.patch<ProjectView>(`/projects/${project.id}`, {
        draft_material: sending.material,
        draft_prompt: sending.prompt,
        draft_attachment_ids: sending.attachments.map((f) => f.id),
        draft_sources: sending.sources,
        expected_draft_version: version.current,
      })
      version.current = p.draft_version
      qc.setQueryData(keys.project(project.id), p)
      setSaved(sending)
      setError(null)
    } catch (err) {
      setError({
        message: errorMessage(err),
        conflict: err instanceof ApiRequestError && err.status === 409,
      })
    } finally {
      setSaving(false)
    }
  }, [project.id, qc])

  const dirty =
    values.material !== saved.material ||
    values.prompt !== saved.prompt ||
    JSON.stringify(values.attachments.map((f) => f.id)) !==
      JSON.stringify(saved.attachments.map((f) => f.id)) ||
    JSON.stringify(values.sources) !== JSON.stringify(saved.sources)

  useEffect(() => {
    if (!dirty || saving || error?.conflict) return
    const t = setTimeout(() => void save(), error ? 3000 : 800)
    return () => clearTimeout(t)
  }, [dirty, saving, error, save, values])

  const reloadFromServer = useCallback(async () => {
    const p = await api.get<ProjectView>(`/projects/${project.id}`)
    qc.setQueryData(keys.project(project.id), p)
    version.current = p.draft_version
    const v = {
      material: p.draft_material,
      prompt: p.draft_prompt,
      attachments: p.draft_attachments,
      sources: p.draft_sources ?? {},
    }
    setValues(v)
    setSaved(v)
    setError(null)
  }, [project.id, qc])

  const status: DraftStatus = error
    ? error.conflict
      ? "conflict"
      : "error"
    : saving
      ? "saving"
      : dirty
        ? "pending"
        : "saved"

  return {
    sources: values.sources,
    applyLibrary: (content: LibraryAppliedView) =>
      setValues((v) => ({
        ...v,
        ...(content.kind === "material"
          ? { material: content.content, attachments: content.attachments }
          : { prompt: content.content }),
        sources: { ...v.sources, [content.kind]: content.source },
      })),
    attachments: values.attachments,
    setAttachments: (attachments: AttachmentView[]) =>
      setValues((v) => ({ ...v, attachments })),
    material: values.material,
    prompt: values.prompt,
    setMaterial: (material: string) => setValues((v) => ({ ...v, material })),
    setPrompt: (prompt: string) => setValues((v) => ({ ...v, prompt })),
    status,
    errorMessage: error?.message ?? null,
    reloadFromServer,
  }
}
