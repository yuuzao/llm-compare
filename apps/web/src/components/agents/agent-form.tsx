import { agentConfigInputSchema, type AgentConfigInput, type AgentConfigView } from "@llm-compare/shared"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { api, ApiRequestError, errorMessage } from "@/lib/api"
import { keys } from "@/lib/queries"

type Form = {
  name: string
  command: string
  args: string
  home_mode: AgentConfigInput["home_mode"]
  mounts: { host_path: string; sandbox_path: string; mode: AgentConfigInput["mounts"][number]["mode"] }[]
  env: { name: string; value: string }[]
  model_config_id: string
  thought_mode: AgentConfigInput["thought_mode"]
  thought_config_id: string
  readonly_config_id: string
  readonly_value: string
  clean_status: AgentConfigInput["clean_status"]
  clean_verification_note: string
}

const EMPTY: Form = {
  name: "",
  command: "",
  args: "",
  home_mode: "clean",
  mounts: [],
  env: [],
  model_config_id: "",
  thought_mode: "none",
  thought_config_id: "",
  readonly_config_id: "",
  readonly_value: "",
  clean_status: "unverified",
  clean_verification_note: "",
}

function fromView(a: AgentConfigView): Form {
  return {
    name: a.name,
    command: a.command,
    args: a.args.join("\n"),
    home_mode: a.home_mode,
    mounts: a.mounts.map((m) => ({ host_path: m.host_path, sandbox_path: m.sandbox_path ?? "", mode: m.mode })),
    env: a.env.map((e) => ({ ...e })),
    model_config_id: a.model_config_id ?? "",
    thought_mode: a.thought_mode,
    thought_config_id: a.thought_config_id ?? "",
    readonly_config_id: a.readonly_config_id ?? "",
    readonly_value: a.readonly_value ?? "",
    clean_status: a.clean_status,
    clean_verification_note: a.clean_verification_note ?? "",
  }
}

const orNull = (s: string) => (s.trim() === "" ? null : s.trim())

function toInput(f: Form): unknown {
  return {
    name: f.name,
    command: f.command,
    args: f.args.split("\n").filter((l) => l.length > 0),
    home_mode: f.home_mode,
    mounts: f.mounts.map((m) => ({ host_path: m.host_path, sandbox_path: orNull(m.sandbox_path), mode: m.mode })),
    env: f.env,
    model_config_id: orNull(f.model_config_id),
    thought_mode: f.thought_mode,
    thought_config_id: orNull(f.thought_config_id),
    readonly_config_id: orNull(f.readonly_config_id),
    readonly_value: orNull(f.readonly_value),
    clean_status: f.clean_status,
    clean_verification_note: orNull(f.clean_verification_note),
  }
}

type Props = { open: boolean; onOpenChange: (o: boolean) => void; agent: AgentConfigView | null; onSaved: (a: AgentConfigView) => void }

export function AgentFormDialog({ open, onOpenChange, agent, onSaved }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90svh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{agent ? `编辑 ${agent.name}` : "新建 Agent 配置"}</DialogTitle>
          <DialogDescription>修改启动方式或挂载后，需要重新进行输出纯净性检查才能使用。</DialogDescription>
        </DialogHeader>
        {open && <AgentFormBody key={agent?.id ?? "new"} agent={agent} onSaved={onSaved} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function AgentFormBody({ agent, onSaved, onCancel }: { agent: AgentConfigView | null; onSaved: (a: AgentConfigView) => void; onCancel: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState<Form>(() => (agent ? fromView(agent) : EMPTY))
  const [issues, setIssues] = useState<Record<string, string>>({})
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((prev) => ({ ...prev, [k]: v }))
  const optionIds = agent?.probe?.config_options.map((o) => o.id) ?? []

  const save = useMutation({
    mutationFn: (input: unknown) => (agent ? api.put<AgentConfigView>(`/agent-configs/${agent.id}`, input) : api.post<AgentConfigView>("/agent-configs", input)),
    onSuccess: (a) => {
      void qc.invalidateQueries({ queryKey: keys.agents })
      void qc.invalidateQueries({ queryKey: keys.models(a.id) })
      onSaved(a)
    },
    onError: (e) => {
      if (e instanceof ApiRequestError) setIssues(e.fields)
    },
  })

  const submit = () => {
    const input = toInput(f)
    const parsed = agentConfigInputSchema.safeParse(input)
    if (!parsed.success) {
      setIssues(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])))
      return
    }
    setIssues({})
    save.mutate(parsed.data)
  }

  const err = (path: string) => issues[path]
  const fieldProps = (path: string) => ({ "data-invalid": err(path) ? true : undefined })

  return (
    <>
      <ScrollArea className="min-h-0 flex-1 pr-3">
        <FieldGroup className="gap-5 pb-2">
          <Field {...fieldProps("name")}>
            <FieldLabel htmlFor="agent-name">名称</FieldLabel>
            <Input id="agent-name" value={f.name} onChange={(e) => set("name", e.target.value)} />
            {err("name") && <FieldError>{err("name")}</FieldError>}
          </Field>
          <Field {...fieldProps("command")}>
            <FieldLabel htmlFor="agent-command">ACP 启动命令</FieldLabel>
            <Input id="agent-command" className="font-mono" placeholder="node" value={f.command} onChange={(e) => set("command", e.target.value)} />
            <FieldDescription>在沙箱内执行；命令所在目录需要在 /usr 下或通过挂载可见。</FieldDescription>
            {err("command") && <FieldError>{err("command")}</FieldError>}
          </Field>
          <Field>
            <FieldLabel htmlFor="agent-args">参数（每行一个）</FieldLabel>
            <Textarea id="agent-args" className="min-h-16 font-mono text-xs" value={f.args} onChange={(e) => set("args", e.target.value)} />
          </Field>
          <Field>
            <FieldLabel>主目录模式</FieldLabel>
            <Select
              value={f.home_mode}
              onValueChange={(v) => setF((prev) => ({ ...prev, home_mode: v as Form["home_mode"], clean_status: v === "overlay" ? "unverified" : prev.clean_status }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="clean">干净：空主目录，只挂载下方列出的文件</SelectItem>
                  <SelectItem value="overlay">沿用全局配置：主目录只读叠加临时写入层</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <FieldSet>
            <FieldLegend variant="label">挂载</FieldLegend>
            <FieldDescription>沙箱路径留空表示与宿主机路径相同。只读（ro）、可写（rw）、临时叠加（overlay，写入随进程丢弃）。</FieldDescription>
            {f.mounts.map((m, i) => (
              <div key={i} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Input
                    aria-label="宿主机路径"
                    className="flex-1 font-mono text-xs"
                    placeholder="宿主机绝对路径"
                    aria-invalid={err(`mounts.${i}.host_path`) ? true : undefined}
                    value={m.host_path}
                    onChange={(e) => set("mounts", f.mounts.map((x, j) => (j === i ? { ...x, host_path: e.target.value } : x)))}
                  />
                  <Input
                    aria-label="沙箱路径"
                    className="flex-1 font-mono text-xs"
                    placeholder="沙箱内路径（可空）"
                    value={m.sandbox_path}
                    onChange={(e) => set("mounts", f.mounts.map((x, j) => (j === i ? { ...x, sandbox_path: e.target.value } : x)))}
                  />
                  <Select value={m.mode} onValueChange={(v) => set("mounts", f.mounts.map((x, j) => (j === i ? { ...x, mode: v as typeof m.mode } : x)))}>
                    <SelectTrigger className="w-28" aria-label="挂载方式">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="ro">只读</SelectItem>
                        <SelectItem value="rw">可写</SelectItem>
                        <SelectItem value="overlay">临时叠加</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Button size="icon-sm" variant="ghost" aria-label="移除挂载" onClick={() => set("mounts", f.mounts.filter((_, j) => j !== i))}>
                    <Trash2Icon />
                  </Button>
                </div>
                {(err(`mounts.${i}.host_path`) ?? err(`mounts.${i}.sandbox_path`)) && (
                  <FieldError>{err(`mounts.${i}.host_path`) ?? err(`mounts.${i}.sandbox_path`)}</FieldError>
                )}
              </div>
            ))}
            <Button size="sm" variant="outline" className="self-start" onClick={() => set("mounts", [...f.mounts, { host_path: "", sandbox_path: "", mode: "ro" }])}>
              <PlusIcon data-icon="inline-start" />
              添加挂载
            </Button>
          </FieldSet>

          <FieldSet>
            <FieldLegend variant="label">环境变量覆盖</FieldLegend>
            <FieldDescription>沙箱会清空环境，只设置 HOME、PATH、USER、LANG 与这里列出的变量。</FieldDescription>
            {f.env.map((e, i) => (
              <div key={i} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Input
                    aria-label="变量名"
                    className="w-56 font-mono text-xs"
                    placeholder="NAME"
                    aria-invalid={err(`env.${i}.name`) ? true : undefined}
                    value={e.name}
                    onChange={(ev) => set("env", f.env.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)))}
                  />
                  <Input
                    aria-label="变量值"
                    className="flex-1 font-mono text-xs"
                    placeholder="值"
                    value={e.value}
                    onChange={(ev) => set("env", f.env.map((x, j) => (j === i ? { ...x, value: ev.target.value } : x)))}
                  />
                  <Button size="icon-sm" variant="ghost" aria-label="移除变量" onClick={() => set("env", f.env.filter((_, j) => j !== i))}>
                    <Trash2Icon />
                  </Button>
                </div>
                {err(`env.${i}.name`) && <FieldError>{err(`env.${i}.name`)}</FieldError>}
              </div>
            ))}
            <Button size="sm" variant="outline" className="self-start" onClick={() => set("env", [...f.env, { name: "", value: "" }])}>
              <PlusIcon data-icon="inline-start" />
              添加变量
            </Button>
          </FieldSet>

          <FieldSet>
            <FieldLegend variant="label">ACP 会话配置项</FieldLegend>
            <FieldDescription>{optionIds.length > 0 ? `检测到的配置项：${optionIds.join("、")}` : "保存后先运行检测，可看到 Agent 实际提供的配置项标识。"}</FieldDescription>
            <Field {...fieldProps("model_config_id")}>
              <FieldLabel htmlFor="agent-model-id">模型配置项标识</FieldLabel>
              <Input id="agent-model-id" className="font-mono" placeholder="留空表示不能设置模型" value={f.model_config_id} onChange={(e) => set("model_config_id", e.target.value)} />
              {err("model_config_id") && <FieldError>{err("model_config_id")}</FieldError>}
            </Field>
            <Field>
              <FieldLabel>思考强度设置方式</FieldLabel>
              <Select value={f.thought_mode} onValueChange={(v) => setF((prev) => ({ ...prev, thought_mode: v as Form["thought_mode"], thought_config_id: v === "option" ? prev.thought_config_id : "" }))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="none">不支持</SelectItem>
                    <SelectItem value="option">独立配置项</SelectItem>
                    <SelectItem value="in_model">随模型取值设置</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            {f.thought_mode === "option" && (
              <Field {...fieldProps("thought_config_id")}>
                <FieldLabel htmlFor="agent-thought-id">思考强度配置项标识</FieldLabel>
                <Input id="agent-thought-id" className="font-mono" value={f.thought_config_id} onChange={(e) => set("thought_config_id", e.target.value)} />
                {err("thought_config_id") && <FieldError>{err("thought_config_id")}</FieldError>}
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="agent-ro-id">只读模式配置项</FieldLabel>
                <Input id="agent-ro-id" className="font-mono" placeholder="可留空" value={f.readonly_config_id} onChange={(e) => set("readonly_config_id", e.target.value)} />
              </Field>
              <Field {...fieldProps("readonly_value")}>
                <FieldLabel htmlFor="agent-ro-value">只读模式取值</FieldLabel>
                <Input id="agent-ro-value" className="font-mono" placeholder="可留空" value={f.readonly_value} onChange={(e) => set("readonly_value", e.target.value)} />
                {err("readonly_value") && <FieldError>{err("readonly_value")}</FieldError>}
              </Field>
            </div>
          </FieldSet>

          {f.home_mode === "clean" && (
            <FieldSet>
              <FieldLegend variant="label">干净环境验证</FieldLegend>
              <Field {...fieldProps("clean_status")}>
                <Select value={f.clean_status} onValueChange={(v) => set("clean_status", v as Form["clean_status"])}>
                  <SelectTrigger className="w-full" aria-label="验证状态">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="unverified">未验证</SelectItem>
                      <SelectItem value="verified">已验证不读取全局上下文文件</SelectItem>
                      <SelectItem value="not_guaranteed">不保证干净</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {err("clean_status") && <FieldError>{err("clean_status")}</FieldError>}
              </Field>
              <Field {...fieldProps("clean_verification_note")}>
                <FieldLabel htmlFor="agent-clean-note">验证方式与结论</FieldLabel>
                <Textarea id="agent-clean-note" className="min-h-16" value={f.clean_verification_note} onChange={(e) => set("clean_verification_note", e.target.value)} />
                {err("clean_verification_note") && <FieldError>{err("clean_verification_note")}</FieldError>}
              </Field>
            </FieldSet>
          )}
        </FieldGroup>
      </ScrollArea>
      {save.isError && !(save.error instanceof ApiRequestError && Object.keys(save.error.fields).length > 0) && (
        <Alert variant="destructive">
          <AlertTitle>保存失败</AlertTitle>
          <AlertDescription>{errorMessage(save.error)}</AlertDescription>
        </Alert>
      )}
      {Object.keys(issues).length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>请修正标出的字段</AlertTitle>
          <AlertDescription>{Object.values(issues).join("；")}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button disabled={save.isPending} onClick={submit}>
          {save.isPending && <Spinner data-icon="inline-start" />}
          保存
        </Button>
      </DialogFooter>
    </>
  )
}
