import type { ProviderInput, ProviderModel, ProviderView, ThoughtLevelView } from "@llm-compare/shared"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { ErrorState, LoadingRows } from "@/components/common/states"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { api, errorMessage } from "@/lib/api"
import { keys, useLevels, useProviders } from "@/lib/queries"

const emptyModel = (): ProviderModel => ({ id: "", name: "", images: false, pdf: false, thought_levels: {} })
export function ProvidersPage() {
  const providers = useProviders()
  const levels = useLevels()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<ProviderView | "new" | null>(null)
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/providers/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: keys.providers }) })
  return <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
    <div className="flex items-center gap-4"><h1 className="text-base font-semibold">API Provider</h1><Button disabled={!levels.data} onClick={() => setEditing("new")}>新建 Provider</Button></div>
    <p className="text-sm text-muted-foreground">直接发送单轮 API 请求，可与本地 Agent 自由组合。模型及图片、PDF 能力按服务实际支持情况登记。</p>
    {providers.isPending || levels.isPending ? <LoadingRows /> : providers.isError || levels.isError ? <ErrorState error={providers.error ?? levels.error} /> : providers.data.map((p) => <Card key={p.id} className="max-w-3xl"><CardHeader><CardTitle>{p.name}</CardTitle><CardDescription>{p.protocol === "responses" ? "Responses" : "Chat Completions"} · {p.base_url}</CardDescription></CardHeader><CardContent className="flex flex-col gap-3"><p className="text-sm">{p.models.map((m) => m.name).join("、")}</p><div className="flex gap-2"><Button variant="outline" onClick={() => setEditing(p)}>编辑 {p.name}</Button><Button variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(p.id)}>移除 {p.name}</Button></div></CardContent></Card>)}
    {providers.data?.length === 0 && <p className="text-sm text-muted-foreground">尚未配置 Provider。</p>}
    {remove.isError && <ErrorState error={remove.error} />}
    <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}><DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">{editing && levels.data && <ProviderForm key={editing === "new" ? "new" : editing.id} initial={editing === "new" ? null : editing} levels={levels.data} onDone={() => setEditing(null)} />}</DialogContent></Dialog>
  </div>
}
function ProviderForm({ initial, levels, onDone }: { initial: ProviderView | null; levels: ThoughtLevelView[]; onDone: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(initial?.name ?? "")
  const [url, setUrl] = useState(initial?.base_url ?? "")
  const [protocol, setProtocol] = useState<ProviderInput["protocol"]>(initial?.protocol ?? "chat_completions")
  const [key, setKey] = useState("")
  const [models, setModels] = useState(() => (initial?.models ?? [emptyModel()]).map((m) => ({ key: crypto.randomUUID(), value: m })))
  const save = useMutation({ mutationFn: () => {
    const body: ProviderInput = { name, base_url: url, protocol, models: models.map((m) => m.value), ...(key ? { api_key: key } : {}) }
    return initial ? api.put(`/providers/${initial.id}`, body) : api.post("/providers", body)
  }, onSuccess: () => { void qc.invalidateQueries({ queryKey: keys.providers }); onDone() } })
  const patch = (id: string, value: Partial<ProviderModel>) => setModels((current) => current.map((m) => m.key === id ? { ...m, value: { ...m.value, ...value } } : m))
  return <>
    <DialogHeader><DialogTitle>{initial ? "编辑 Provider" : "新建 Provider"}</DialogTitle><DialogDescription>API Key 保存在本机，保存后不再显示。模型能力需与服务保持一致。</DialogDescription></DialogHeader>
    <Field><FieldLabel htmlFor="provider-name">Provider 名称</FieldLabel><Input id="provider-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
    <Field><FieldLabel htmlFor="provider-url">API 基础地址</FieldLabel><Input id="provider-url" placeholder="https://api.example.com/v1" value={url} onChange={(e) => setUrl(e.target.value)} /><FieldDescription>包含服务要求的路径前缀；不填写 /responses 或 /chat/completions。</FieldDescription></Field>
    <Field><FieldLabel>API 协议</FieldLabel><Select value={protocol} onValueChange={(v) => setProtocol(v as ProviderInput["protocol"])}><SelectTrigger aria-label="API 协议" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="chat_completions">Chat Completions</SelectItem><SelectItem value="responses">Responses</SelectItem></SelectContent></Select></Field>
    <Field><FieldLabel htmlFor="provider-key">API Key</FieldLabel><Input id="provider-key" type="password" autoComplete="new-password" placeholder={initial ? "留空保留现有凭据" : "填写 API Key"} value={key} onChange={(e) => setKey(e.target.value)} /></Field>
    {models.map(({ key: rowKey, value: m }, i) => <section key={rowKey} aria-label={`Provider 模型 ${i + 1}`} className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-center justify-between"><span className="text-sm font-medium">模型 {i + 1}</span><Button size="sm" variant="ghost" disabled={models.length === 1} onClick={() => setModels((rows) => rows.filter((r) => r.key !== rowKey))}>移除模型 {i + 1}</Button></div>
      <Field><FieldLabel htmlFor={`model-id-${rowKey}`}>模型 ID</FieldLabel><Input id={`model-id-${rowKey}`} value={m.id} onChange={(e) => patch(rowKey, { id: e.target.value })} /></Field>
      <Field><FieldLabel htmlFor={`model-name-${rowKey}`}>显示名称</FieldLabel><Input id={`model-name-${rowKey}`} value={m.name} onChange={(e) => patch(rowKey, { name: e.target.value })} /></Field>
      <Field orientation="horizontal"><Switch id={`images-${rowKey}`} checked={m.images} onCheckedChange={(images) => patch(rowKey, { images })} /><FieldLabel htmlFor={`images-${rowKey}`}>支持图片输入</FieldLabel></Field>
      <Field orientation="horizontal"><Switch id={`pdf-${rowKey}`} checked={m.pdf} onCheckedChange={(pdf) => patch(rowKey, { pdf })} /><FieldLabel htmlFor={`pdf-${rowKey}`}>支持 PDF 输入</FieldLabel></Field>
      <FieldDescription>思考强度：填入该模型的原生 effort 值，全部留空表示不支持设置。</FieldDescription>
      {levels.map((l) => <Field key={l.id}><FieldLabel htmlFor={`${rowKey}-${l.id}`}>{l.name}的原生值</FieldLabel><Input id={`${rowKey}-${l.id}`} value={m.thought_levels[l.id] ?? ""} placeholder="例如 low、medium、high" onChange={(e) => { const next = { ...m.thought_levels }; if (e.target.value) next[l.id] = e.target.value; else delete next[l.id]; patch(rowKey, { thought_levels: next }) }} /></Field>)}
    </section>)}
    <Button variant="outline" onClick={() => setModels((rows) => [...rows, { key: crypto.randomUUID(), value: emptyModel() }])}>添加模型</Button>
    {save.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(save.error)}</AlertDescription></Alert>}
    <Button disabled={save.isPending || !name || !url || (!initial && !key) || models.some((m) => !m.value.id || !m.value.name)} onClick={() => save.mutate()}>{save.isPending ? "保存中…" : "保存 Provider"}</Button>
  </>
}
