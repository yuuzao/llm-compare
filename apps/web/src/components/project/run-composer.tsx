import type {
  LibrarySources,
  AgentConfigView,
  AttachmentView,
  ProviderView,
  ModelOptionView,
  RunPacket,
} from "@llm-compare/shared"
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query"
import {
  ArrowUpIcon,
  CheckIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RotateCwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { useRef, useState } from "react"
import { Link } from "react-router"
import {
  ModelParameters,
  parameterValues,
  validParameters,
} from "@/components/agents/model-parameters"
import { ErrorState, LoadingRows } from "@/components/common/states"
import { ModelSelect } from "@/components/common/model-select"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { api, errorMessage } from "@/lib/api"
import { runKindLabel } from "@/lib/format"
import {
  keys,
  refreshThoughtOptions,
  thoughtOptionsQuery,
  useAgents,
  useLevels,
  useProviders,
} from "@/lib/queries"

const NO_LEVEL = "__none__"
const MAX_TARGETS = 4
export type ComposerPreset = { source: RunPacket }
type Props = {
  projectId: string
  material: string
  sources?: LibrarySources
  prompt: string
  attachments: AttachmentView[]
  uploadBusy: boolean
  preset: ComposerPreset | null
  onCreated: (run: RunPacket) => void
}
type Row = {
  kind: "agent" | "provider"
  key: string
  agentId: string
  agentName: string
  model: string | null
  levelId: string
  levelName: string | null
  parameters: Record<string, string>
}
const emptyRow = (): Row => ({
  kind: "agent",
  key: crypto.randomUUID(),
  agentId: "",
  agentName: "",
  model: null,
  levelId: NO_LEVEL,
  levelName: null,
  parameters: {},
})

function agentEnvironment(agent: AgentConfigView, compact = false) {
  return agent.home_mode === "clean"
    ? agent.clean_status === "verified"
      ? compact
        ? "干净✓"
        : "干净 · 已验证"
      : compact
        ? "未验证"
        : "干净 · 未验证"
    : compact
      ? "全局"
      : "全局环境"
}

export function RunComposer(props: Props) {
  const agents = useAgents()
  const levels = useLevels()
  const providers = useProviders()
  if (agents.isPending || levels.isPending || providers.isPending)
    return <LoadingRows rows={3} />
  const err = agents.error ?? levels.error ?? providers.error
  if (err)
    return (
      <ErrorState
        title="对比配置加载失败"
        error={err}
        onRetry={() =>
          void Promise.all([
            agents.refetch(),
            levels.refetch(),
            providers.refetch(),
          ])
        }
      />
    )
  return (
    <ComposerForm
      {...props}
      agents={agents.data!}
      levels={levels.data!}
      providers={providers.data!}
    />
  )
}

function ComposerForm({
  projectId,
  material,
  sources,
  prompt,
  attachments,
  uploadBusy,
  preset,
  onCreated,
  agents,
  levels,
  providers,
}: Props & {
  agents: AgentConfigView[]
  levels: { id: string; name: string }[]
  providers: ProviderView[]
}) {
  const qc = useQueryClient()
  const editor = useRef<HTMLElement>(null)
  const [rows, setRows] = useState<Row[]>(() =>
    preset
      ? preset.source.targets.map((t) => ({
          key: crypto.randomUUID(),
          kind: t.snapshot.kind === "provider" ? "provider" : "agent",
          agentId:
            t.snapshot.kind === "provider"
              ? t.snapshot.provider_id
              : t.snapshot.agent_config_id,
          agentName:
            t.snapshot.kind === "provider"
              ? t.snapshot.provider_name
              : t.snapshot.agent_config_name,
          model:
            t.snapshot.kind !== "provider" &&
            t.snapshot.config.thought_mode === "in_model"
              ? t.snapshot.model_value
              : t.snapshot.base_model,
          levelId:
            t.snapshot.kind === "provider"
              ? (t.snapshot.thought_level_id ?? NO_LEVEL)
              : t.snapshot.config.thought_mode === "in_model"
                ? NO_LEVEL
                : (t.snapshot.thought_native_value ?? NO_LEVEL),
          parameters:
            t.snapshot.kind === "provider"
              ? {}
              : Object.fromEntries(
                  t.snapshot.settings
                    .filter((s) => s.kind === "model_parameter")
                    .map((s) => [s.config_id, s.value])
                ),
          levelName:
            t.snapshot.kind !== "provider" &&
            t.snapshot.config.thought_mode === "in_model"
              ? "随模型设置"
              : t.snapshot.thought_level_name,
        }))
      : []
  )
  const [draft, setDraft] = useState<Row>(emptyRow)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  // 环境由各对象选中的 Agent 配置决定；保留整轮字段供后端校验和历史读取。
  const requireClean = rows
    .filter((r) => r.kind === "agent")
    .every((r) => {
      const agent = agents.find((a) => a.id === r.agentId)
      return agent?.home_mode === "clean" && agent.clean_status === "verified"
    })
  const idem = useRef<{ body: string; key: string } | null>(null)
  // 查询按 Agent 去重；重复对象仍保留各自的行身份和模型选择。
  const modelAgents = [
    ...new Set(
      [...rows, draft].filter((r) => r.kind === "agent").map((r) => r.agentId)
    ),
  ].filter((id) => agents.some((a) => a.id === id && a.model_config_id))
  const modelQueries = useQueries({
    queries: modelAgents.map((id) => ({
      queryKey: keys.models(id),
      queryFn: () =>
        api
          .get<{ items: ModelOptionView[] }>(`/agent-configs/${id}/models`)
          .then((r) => r.items),
    })),
  })
  const thoughtRows = [
    ...new Map(
      [...rows, draft]
        .filter(
          (r) => r.kind === "agent" && agents.some((a) => a.id === r.agentId)
        )
        .map((r) => [JSON.stringify([r.agentId, r.model]), r])
    ).values(),
  ]
  const thoughtQueries = useQueries({
    queries: thoughtRows.map((r) =>
      thoughtOptionsQuery(
        agents.find((a) => a.id === r.agentId),
        r.model
      )
    ),
  })
  const inspectRow = (row: Row) => {
    const provider =
      row.kind === "provider"
        ? providers.find((p) => p.id === row.agentId)
        : undefined
    const agent =
      row.kind === "agent"
        ? agents.find((a) => a.id === row.agentId)
        : undefined
    const providerModel = provider?.models.find((m) => m.id === row.model)
    const models = modelQueries[modelAgents.indexOf(row.agentId)]
    const thought =
      thoughtQueries[
        thoughtRows.findIndex(
          (r) => r.agentId === row.agentId && r.model === row.model
        )
      ]
    const supportsThought = providerModel
      ? Object.keys(providerModel.thought_levels).length > 0
      : thought?.data?.mode === "option"
    const availableLevels = providerModel
      ? levels.filter((l) => l.id in providerModel.thought_levels)
      : (thought?.data?.values.map((v) => ({ id: v.value, name: v.name })) ??
        [])
    const levelId = row.levelId
    let issue: string | null = null
    if (row.kind === "provider") {
      if (!provider)
        issue = row.agentId
          ? `${row.agentName} 已删除，请重新选择`
          : "请选择 API Provider"
      else if (!providerModel) issue = "请选择已登记的模型"
    } else if (!agent)
      issue = row.agentId
        ? `${row.agentName} 已删除或不可用，请重新选择`
        : "请选择 Agent 配置"
    else if (!agent.available) issue = agent.unavailable_reasons.join("；")
    else if (agent.model_config_id) {
      if (!agent.capabilities.set_model || !agent.capabilities.report_model)
        issue = "不能设置或回读模型，请重新检测"
      else if (models?.isPending) issue = "正在加载模型"
      else if (models?.isError)
        issue = `模型加载失败：${errorMessage(models.error)}`
      else if (!models?.data?.length)
        issue = "未检测到模型，请到 Agent 设置中重新检测"
      else if (!row.model) issue = "请选择模型"
      else if (!models.data.some((m) => m.value === row.model))
        issue = `原模型 ${row.model} 已不在检测结果中，请重新选择`
    } else if (row.model !== null)
      issue = "该 Agent 不能设置模型，请选择使用 Agent 当前模型"
    if (!issue && providerModel) {
      const hasThought = Object.keys(providerModel.thought_levels).length > 0
      if (hasThought && !providerModel.thought_levels[levelId])
        issue = "请选择该模型已映射的思考强度档位"
      else if (!hasThought && levelId !== NO_LEVEL)
        issue = "该模型不支持设置思考强度，请选择不设置"
    }
    if (!issue && agent) {
      if (thought?.isPending || thought?.isFetching)
        issue = "正在读取思考强度选项…"
      else if (thought?.isError)
        issue = `思考强度读取失败：${errorMessage(thought.error)}`
      else if (
        supportsThought &&
        !availableLevels.some((l) => l.id === levelId)
      )
        issue = "请选择 Agent 返回的思考强度选项"
      else if (!supportsThought && levelId !== NO_LEVEL)
        issue = "该模型不支持独立设置思考强度，请选择不设置"
      else if (
        thought?.data &&
        !validParameters(thought.data.parameters, row.parameters)
      )
        issue = "模型参数已失效，请重新选择"
    }
    if (
      !issue &&
      provider &&
      levelId !== NO_LEVEL &&
      !levels.some((l) => l.id === levelId)
    )
      issue = "原思考强度档位已删除，请重新选择"
    const selectionIssue = issue
    if (!issue && attachments.length) {
      const image = providerModel
        ? providerModel.images
        : agent?.probe?.prompt_capabilities.image
      const pdf = providerModel
        ? providerModel.pdf
        : agent?.probe?.prompt_capabilities.embeddedContext
      if (attachments.some((f) => f.kind === "image") && !image)
        issue = "该对象未声明支持图片输入"
      if (attachments.some((f) => f.kind === "pdf") && !pdf)
        issue = "该对象未声明支持 PDF 输入"
    }
    return {
      agent,
      provider,
      models,
      options: provider
        ? provider.models.map((m) => ({ value: m.id, name: m.name }))
        : models?.data,
      selectionIssue,
      issue,
      supportsThought,
      availableLevels,
      thought,
    }
  }
  const rowInfo = rows.map(inspectRow)
  const draftInfo = inspectRow(draft)
  const blocker = editingKey
    ? "请先保存或取消对象修改"
    : !rows.length
      ? "请先添加对比对象"
      : uploadBusy
        ? "请等待附件上传完成"
        : !prompt.trim()
          ? "请先填写提示词"
          : rowInfo.some((r) => r.issue)
            ? "请完善对比对象配置"
            : null
  const create = useMutation({
    mutationFn: () => {
      const body = {
        material,
        library_sources: sources ?? {},
        prompt,
        attachment_ids: attachments.map((f) => f.id),
        source_run_id: preset?.source.id ?? null,
        require_clean: requireClean,
        targets: rows.map((r) =>
          r.kind === "provider"
            ? {
                provider_id: r.agentId,
                model: r.model,
                thought_level_id: r.levelId === NO_LEVEL ? null : r.levelId,
              }
            : {
                agent_config_id: r.agentId,
                model: r.model,
                thought_value: r.levelId === NO_LEVEL ? null : r.levelId,
                model_parameters: r.parameters,
              }
        ),
      }
      const text = JSON.stringify(body)
      if (idem.current?.body !== text)
        idem.current = { body: text, key: crypto.randomUUID() }
      return api.post<RunPacket>(`/projects/${projectId}/runs`, {
        ...body,
        idempotency_key: idem.current.key,
      })
    },
    onSuccess: (run) => {
      idem.current = null
      qc.setQueryData(keys.run(run.id), run)
      void qc.invalidateQueries({ queryKey: keys.runs(projectId) })
      void qc.invalidateQueries({ queryKey: ["projects"] })
      onCreated(run)
    },
  })
  const patchDraft = (patch: Partial<Row>) =>
    setDraft((current) => ({ ...current, ...patch }))
  const resetEditor = () => {
    setEditingKey(null)
    setDraft(emptyRow())
  }
  const commitDraft = () => {
    if (
      draftInfo.selectionIssue ||
      create.isPending ||
      (!editingKey && rows.length >= MAX_TARGETS)
    )
      return
    const saved = {
      ...draft,
      parameters: parameterValues(
        draftInfo.thought?.data?.parameters ?? [],
        draft.parameters
      ),
      levelName:
        draftInfo.thought?.data?.mode === "in_model"
          ? "随模型设置"
          : (draftInfo.availableLevels.find((l) => l.id === draft.levelId)
              ?.name ?? null),
    }
    setRows((current) =>
      editingKey
        ? current.map((row) =>
            row.key === editingKey ? { ...saved, key: editingKey } : row
          )
        : [...current, saved]
    )
    setEditingKey(null)
    // 保留配置方便选择下一个模型，清空模型与档位以明确本次已添加。
    setDraft((current) => ({
      ...current,
      key: crypto.randomUUID(),
      model: null,
      levelId: NO_LEVEL,
      levelName: null,
      parameters: {},
    }))
  }
  const {
    agent,
    provider,
    models,
    options,
    selectionIssue,
    supportsThought,
    availableLevels,
    thought,
  } = draftInfo
  const levelOptions = availableLevels
  const missingLevel =
    draft.levelId !== NO_LEVEL &&
    !levelOptions.some((l) => l.id === draft.levelId)

  return (
    <FieldGroup className="@container/composer min-w-0 gap-2">
      {preset && (
        <p className="text-xs text-muted-foreground">
          基于第 {preset.source.run_number} 轮继续 · 已恢复输入与对比对象
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <FieldLabel>
          对比对象（{rows.length}/{MAX_TARGETS}）
        </FieldLabel>
        <Badge variant="outline">
          {rows.length ? runKindLabel(rows.length) : "尚未选择"}
        </Badge>
      </div>
      <section
        ref={editor}
        aria-label="选择对比对象"
        className="flex min-w-0 flex-col gap-2"
      >
        {editingKey && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              编辑对象 {rows.findIndex((r) => r.key === editingKey) + 1}
            </span>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="取消修改"
              title="取消修改"
              disabled={create.isPending}
              onClick={resetEditor}
            >
              <XIcon />
            </Button>
          </div>
        )}
        <div
          role="group"
          aria-label="对象选择项"
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] items-start gap-2 @lg/composer:grid-cols-[repeat(4,minmax(0,1fr))_2rem_2rem]"
        >
          <Field className="min-w-0">
            <Select
              value={draft.kind}
              disabled={create.isPending}
              onValueChange={(kind) =>
                patchDraft({
                  kind: kind as Row["kind"],
                  agentId: "",
                  agentName: "",
                  model: null,
                  levelId: NO_LEVEL,
                  levelName: null,
                  parameters: {},
                })
              }
            >
              <SelectTrigger
                className="w-full min-w-0 [&>span]:truncate"
                aria-label="对象类型"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="agent">本地 Agent</SelectItem>
                <SelectItem value="provider">API Provider</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field className="min-w-0">
            <Select
              value={draft.agentId}
              disabled={create.isPending}
              onValueChange={(id) =>
                patchDraft({
                  agentId: id,
                  agentName: [...agents, ...providers].find((a) => a.id === id)!
                    .name,
                  model: null,
                  levelId: NO_LEVEL,
                  levelName: null,
                  parameters: {},
                })
              }
            >
              <SelectTrigger
                className="w-full min-w-0 [&>span]:truncate"
                aria-label={
                  draft.kind === "agent" ? "Agent 配置" : "API Provider"
                }
                title={
                  agent
                    ? `${agent.name} · ${agentEnvironment(agent)}`
                    : provider?.name
                }
              >
                <SelectValue
                  className="min-w-0 flex-1"
                  placeholder={
                    draft.kind === "agent" ? "Agent 配置" : "API Provider"
                  }
                >
                  {agent ? (
                    <>
                      <span className="min-w-0 truncate">{agent.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {agentEnvironment(agent, true)}
                      </span>
                    </>
                  ) : (
                    provider?.name
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {draft.agentId && !agent && !provider && (
                  <SelectItem value={draft.agentId} disabled>
                    {draft.agentName}（已删除）
                  </SelectItem>
                )}
                {draft.kind === "agent"
                  ? agents.map((a) => (
                      <SelectItem
                        key={a.id}
                        value={a.id}
                        disabled={!a.available}
                      >
                        <span>
                          {a.name}
                          {!a.available && "（不可用）"}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {agentEnvironment(a)}
                        </span>
                      </SelectItem>
                    ))
                  : providers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
              </SelectContent>
            </Select>
          </Field>
          <Field className="min-w-0">
            {!agent || agent.model_config_id || provider ? (
              <>
                <ModelSelect
                  value={draft.model ?? ""}
                  options={options ?? []}
                  disabled={
                    create.isPending || !(agent || provider) || !options?.length
                  }
                  placeholder={
                    !(agent || provider)
                      ? "模型"
                      : models?.isPending
                        ? "加载模型中…"
                        : "选择模型"
                  }
                  onValueChange={(model) =>
                    patchDraft({
                      model,
                      levelId: NO_LEVEL,
                      levelName: null,
                      parameters: {},
                    })
                  }
                />
                {models?.isError && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void models.refetch()}
                  >
                    重新加载模型
                  </Button>
                )}
              </>
            ) : (
              <Button
                className="w-full min-w-0"
                variant="outline"
                disabled={create.isPending}
                aria-pressed={draft.model === null}
                onClick={() =>
                  patchDraft({
                    model: null,
                    levelId: NO_LEVEL,
                    levelName: null,
                    parameters: {},
                  })
                }
              >
                <span className="truncate">使用 Agent 当前模型</span>
              </Button>
            )}
          </Field>
          <Field className="min-w-0">
            <Select
              value={
                !(agent || provider) ||
                (!!(agent?.model_config_id || provider) && !draft.model) ||
                (agent && thought?.isFetching)
                  ? ""
                  : supportsThought && draft.levelId === NO_LEVEL
                    ? ""
                    : draft.levelId
              }
              disabled={
                create.isPending ||
                !(agent || provider) ||
                (!!(agent?.model_config_id || provider) && !draft.model) ||
                (!!agent && (!thought?.data || thought.isFetching))
              }
              onValueChange={(levelId) =>
                patchDraft({
                  levelId,
                  levelName:
                    levelOptions.find((l) => l.id === levelId)?.name ?? null,
                })
              }
            >
              <SelectTrigger
                className="w-full min-w-0 [&>span]:truncate"
                aria-label="思考强度"
                title={
                  levelOptions.find((l) => l.id === draft.levelId)?.name ??
                  draft.levelName ??
                  undefined
                }
              >
                <SelectValue
                  placeholder={
                    agent && thought?.isFetching ? "读取选项中…" : "思考强度"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {!supportsThought && (
                  <SelectItem value={NO_LEVEL}>
                    {thought?.data?.mode === "in_model"
                      ? "随模型设置"
                      : "不设置"}
                  </SelectItem>
                )}
                {missingLevel && (
                  <SelectItem value={draft.levelId} disabled>
                    {draft.levelName}（不可用）
                  </SelectItem>
                )}
                {levelOptions.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Button
            size="icon-sm"
            variant={editingKey ? "default" : "outline"}
            aria-label={editingKey ? "保存修改" : "添加到对比"}
            title={
              !editingKey && rows.length >= MAX_TARGETS
                ? `已满 ${MAX_TARGETS} 个对象`
                : editingKey
                  ? "保存修改"
                  : "添加到对比"
            }
            disabled={
              !!selectionIssue ||
              create.isPending ||
              (!editingKey && rows.length >= MAX_TARGETS)
            }
            onClick={commitDraft}
          >
            {editingKey ? <CheckIcon /> : <PlusIcon />}
          </Button>
          <div className="col-start-3 row-start-1 flex h-8 items-center justify-center @lg/composer:col-start-6">
            {agent && (thought?.data || thought?.isError) && (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="重新读取"
                title="重新读取模型参数"
                disabled={create.isPending || thought.isFetching}
                onClick={() =>
                  void refreshThoughtOptions(qc, agent, draft.model).catch(
                    () => undefined
                  )
                }
              >
                {thought.isFetching ? <Spinner /> : <RotateCwIcon />}
              </Button>
            )}
          </div>
        </div>
        {agents.length === 0 && draft.kind === "agent" && (
          <FieldDescription>
            请先到{" "}
            <Link className="underline" to="/settings/agents">
              Agent 设置
            </Link>{" "}
            注册配置。
          </FieldDescription>
        )}
        {agent && !!thought?.data?.parameters.length && (
          <div
            role="group"
            aria-label="模型附加参数"
            className="grid min-w-0 grid-cols-2 gap-2 pr-10 @lg/composer:pr-20 @3xl/composer:grid-cols-4"
          >
            <ModelParameters
              compact
              options={thought.data.parameters}
              value={draft.parameters}
              onChange={(parameters) => patchDraft({ parameters })}
              disabled={create.isPending || thought.isFetching}
            />
          </div>
        )}
        {draft.agentId &&
          selectionIssue &&
          !selectionIssue.startsWith("请选择") &&
          !["正在读取思考强度选项…", "正在加载模型"].includes(
            selectionIssue
          ) && (
            <p role="alert" className="text-xs break-words text-destructive">
              {selectionIssue}
            </p>
          )}
      </section>
      <div
        aria-label="已选对比对象"
        className="grid min-w-0 grid-cols-1 gap-2 empty:hidden @sm/composer:grid-cols-2"
      >
        {rows.map((row, i) => {
          const info = rowInfo[i]!
          const name = info.agent?.name ?? info.provider?.name ?? row.agentName
          const modelName =
            info.options?.find((m) => m.value === row.model)?.name ??
            row.model ??
            "使用 Agent 当前模型"
          return (
            <section
              key={row.key}
              aria-label={`已选对象 ${i + 1}`}
              className={`min-w-0 rounded-lg border px-2 py-1.5 ${editingKey === row.key ? "border-primary bg-muted/50" : ""}`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-xs text-muted-foreground">{i + 1}</span>
                <p
                  className="min-w-0 flex-1 truncate text-sm font-medium"
                  title={name}
                >
                  {name}
                </p>
                <div className="flex shrink-0">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    disabled={!!editingKey || create.isPending}
                    aria-label={`编辑对象 ${i + 1}`}
                    title="编辑"
                    onClick={() => {
                      setDraft({ ...row })
                      setEditingKey(row.key)
                      editor.current?.scrollIntoView({ block: "nearest" })
                    }}
                  >
                    <PencilIcon />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    disabled={i === 0 || !!editingKey || create.isPending}
                    aria-label={`上移对象 ${i + 1}`}
                    title="上移"
                    onClick={() =>
                      setRows((current) => {
                        const next = [...current]
                        ;[next[i - 1], next[i]] = [next[i]!, next[i - 1]!]
                        return next
                      })
                    }
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    disabled={!!editingKey || create.isPending}
                    aria-label={`移除对象 ${i + 1}`}
                    title="移除"
                    onClick={() =>
                      setRows((current) =>
                        current.filter((r) => r.key !== row.key)
                      )
                    }
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </div>
              <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 flex-1 truncate" title={modelName}>
                  {modelName}
                </span>
                <span
                  className="max-w-20 shrink-0 truncate"
                  title={`思考 ${row.levelName ?? "未设置"}`}
                >
                  思考 {row.levelName ?? "未设置"}
                </span>
                {info.agent && (
                  <span
                    title={agentEnvironment(info.agent)}
                    className={`shrink-0 ${info.agent.home_mode === "clean" && info.agent.clean_status === "verified" ? "" : "text-amber-700 dark:text-amber-400"}`}
                  >
                    {agentEnvironment(info.agent, true)}
                  </span>
                )}
              </div>
              {Object.keys(row.parameters).length > 0 && (
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {info.thought?.data?.parameters
                    .map(
                      (o) =>
                        `${o.name}: ${o.values.find((v) => v.value === row.parameters[o.id])?.name ?? row.parameters[o.id]}`
                    )
                    .join(" · ")}
                </p>
              )}
              {info.issue && (
                <p
                  className={`mt-1 text-xs break-words ${["正在读取思考强度选项…", "正在加载模型"].includes(info.issue) ? "text-muted-foreground" : "text-destructive"}`}
                >
                  {info.issue}
                </p>
              )}
            </section>
          )
        })}
      </div>
      {create.isError && (
        <Alert variant="destructive">
          <AlertTitle>无法启动本轮</AlertTitle>
          <AlertDescription>{errorMessage(create.error)}</AlertDescription>
        </Alert>
      )}
      <div className="flex min-w-0 items-center justify-end gap-3">
        <span
          className="min-w-0 truncate text-xs text-muted-foreground"
          title={
            blocker ??
            "可自由组合 Agent 和 Provider，同一份输入发送给所有已选对象"
          }
        >
          {blocker ?? "所有对象接收相同输入"}
        </span>
        <Button
          className="shrink-0"
          size="sm"
          aria-label="运行"
          disabled={blocker !== null || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? <Spinner /> : <PlayIcon />}运行
        </Button>
      </div>
    </FieldGroup>
  )
}
