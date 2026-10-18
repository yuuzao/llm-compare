import type { AttachmentView } from "@llm-compare/shared"
import { useRef, useState } from "react"
import { PaperclipIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { api, errorMessage } from "@/lib/api"

export function AttachmentEditor({ projectId, files, onChange, onBusy }: { projectId: string; files: AttachmentView[]; onChange: (files: AttachmentView[]) => void; onBusy: (busy: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const upload = async (selected: File[]) => {
    if (files.length + selected.length > 10) { setError("每轮最多 10 个附件"); return }
    setUploading(true)
    onBusy(true)
    setError(null)
    const uploaded: AttachmentView[] = []
    try {
      for (const file of selected) {
        const form = new FormData()
        form.append("file", file)
        uploaded.push(await api.post<AttachmentView>(`/projects/${projectId}/attachments`, form))
      }
    } catch (e) { setError(errorMessage(e)) }
    finally { if (uploaded.length) onChange([...files, ...uploaded]); setUploading(false); onBusy(false) }
  }
  return <div className="flex min-w-0 shrink-0 flex-col">
    <input ref={input} id="draft-attachments" aria-label="添加素材附件" className="sr-only" type="file" multiple disabled={uploading || files.length >= 10} accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.md,.csv,.tsv,.json,.jsonl,.yaml,.yml,.log,.xml" onChange={(e) => { const selected = [...(e.target.files ?? [])]; e.target.value = ""; void upload(selected) }} />
    <div className="flex items-center gap-2 border-t px-2 py-1.5">
      <Button size="sm" variant="ghost" disabled={uploading || files.length >= 10} onClick={() => input.current?.click()}><PaperclipIcon />添加附件</Button>
      <span className="min-w-0 truncate text-xs text-muted-foreground" title="支持图片、PDF、UTF-8 文本">{uploading ? "正在上传…" : `${files.length}/10 · 图片、PDF、UTF-8 文本`}</span>
    </div>
    {files.length > 0 && <div className="max-h-32 overflow-y-auto border-t p-2"><AttachmentList files={files} onRemove={uploading ? undefined : (id) => onChange(files.filter((f) => f.id !== id))} /></div>}
    {error && <p role="alert" className="border-t px-3 py-2 text-xs text-destructive">{error}</p>}
  </div>
}

export function AttachmentList({ files, onRemove, contentUrl = (id: string) => `/api/v1/attachments/${id}/content` }: { files: Omit<AttachmentView, "project_id">[]; onRemove?: (id: string) => void; contentUrl?: (id: string) => string }) {
  return <ul className="flex min-w-0 flex-col gap-2">{files.map((f) => <li key={f.id} className="flex min-w-0 items-center gap-2 rounded-md border p-2 text-xs">
    {f.kind === "image" && <img src={contentUrl(f.id)} alt={f.name} className="size-12 shrink-0 rounded object-contain" />}
    <a className="min-w-0 flex-1 truncate underline" href={contentUrl(f.id)} download={f.name} title={`${f.name} · ${f.sha256}`}>{f.name}</a>
    <span className="shrink-0">{Math.ceil(f.size / 1024)} KB</span>{onRemove && <Button type="button" size="icon-xs" variant="ghost" aria-label={`移除附件 ${f.name}`} onClick={() => onRemove(f.id)}>×</Button>}
  </li>)}</ul>
}
