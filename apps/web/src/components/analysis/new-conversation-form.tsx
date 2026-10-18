import type { ConversationView } from "@llm-compare/shared"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { ModelParameters, parameterValues, validParameters } from "@/components/agents/model-parameters"
import { RunScopePicker } from "@/components/analysis/run-scope-picker"
import { ErrorState, LoadingRows } from "@/components/common/states"
import { ModelSelect } from "@/components/common/model-select"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { api, errorMessage } from "@/lib/api"
import { keys, useAgents, useModels, useThoughtOptions } from "@/lib/queries"

const NO_LEVEL = "__none__"

type Props = { projectId: string; suggestedRunId: string | null; onCreated: (c: ConversationView) => void; onCancel?: () => void }

export function NewConversationForm({ projectId, suggestedRunId, onCreated, onCancel }: Props) {
  const qc = useQueryClient()
  const agents = useAgents()
  const [agentId, setAgentId] = useState("")
  const [model, setModel] = useState("")
  const [levelId, setLevelId] = useState(NO_LEVEL)
  const [parameters, setParameters] = useState<Record<string, string>>({})
  const [runIds, setRunIds] = useState<string[]>(suggestedRunId ? [suggestedRunId] : [])
  const agent = agents.data?.find((a) => a.id === agentId) ?? null
  const models = useModels(agent?.model_config_id ? agent.id : null)
  const thought = useThoughtOptions(agent, agent?.model_config_id ? model || null : null)

  const create = useMutation({
    mutationFn: () =>
      api.post<ConversationView>("/conversations", {
        project_id: projectId,
        agent_config_id: agentId,
        model: agent?.model_config_id ? model : null,
        thought_value: levelId === NO_LEVEL ? null : levelId,
        model_parameters: parameterValues(thought.data?.parameters ?? [], parameters),
        scope: { run_ids: runIds },
      }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: keys.conversations(projectId) })
      onCreated(c)
    },
  })

  if (agents.isPending) return <LoadingRows rows={3} />
  if (agents.isError) return <ErrorState error={agents.error} onRetry={() => void agents.refetch()} />

  const ready = agent !== null && (!agent.model_config_id || model !== "") && runIds.length > 0 && !thought.isFetching && !!thought.data && validParameters(thought.data.parameters, parameters) && (thought.data.mode === "option" ? thought.data.values.some((v) => v.value === levelId) : levelId === NO_LEVEL)

  return (
    <FieldGroup className="gap-4 overflow-y-auto">
      <Field>
        <FieldLabel>分析用 Agent</FieldLabel>
        <Select
          value={agentId}
          onValueChange={(v) => {
            setAgentId(v)
            setModel("")
            setLevelId(NO_LEVEL)
            setParameters({})
          }}
        >
          <SelectTrigger className="w-full" aria-label="分析用 Agent">
            <SelectValue placeholder="选择 Agent 配置" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {agents.data.map((a) => (
                <SelectItem key={a.id} value={a.id} disabled={!a.available}>
                  {a.name}
                  {!a.available && "（不可用）"}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      {agent?.model_config_id && (
        <Field>
          <FieldLabel>模型</FieldLabel>
          {models.isPending ? (
            <LoadingRows rows={1} />
          ) : models.isError ? (
            <ErrorState error={models.error} onRetry={() => void models.refetch()} />
          ) : (
            <ModelSelect label="分析模型" value={model} options={models.data} disabled={create.isPending || !models.data.length} onValueChange={(value) => { setModel(value); setLevelId(NO_LEVEL); setParameters({}) }} />
          )}
        </Field>
      )}
      <Field>
        <FieldLabel>思考强度</FieldLabel>
        <Select value={thought.data?.mode === "option" && levelId === NO_LEVEL ? "" : levelId} onValueChange={setLevelId} disabled={!thought.data || thought.isFetching}>
          <SelectTrigger className="w-full" aria-label="分析思考强度"><SelectValue placeholder={thought.isFetching ? "读取选项中…" : "请选择强度"} /></SelectTrigger>
          <SelectContent>
            {thought.data?.mode !== "option" && <SelectItem value={NO_LEVEL}>{thought.data?.mode === "in_model" ? "随模型设置" : "不设置"}</SelectItem>}
            {thought.data?.values.map((v) => <SelectItem key={v.value} value={v.value}>{v.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {thought.isError && <ErrorState error={thought.error} onRetry={() => void thought.refetch()} />}
      </Field>
      {thought.data && <ModelParameters options={thought.data.parameters} value={parameters} onChange={setParameters} disabled={create.isPending || thought.isFetching} />}
      <RunScopePicker projectId={projectId} value={runIds} onChange={setRunIds} />
      {create.isError && (
        <Alert variant="destructive">
          <AlertTitle>无法创建会话</AlertTitle>
          <AlertDescription>{errorMessage(create.error)}</AlertDescription>
        </Alert>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            取消
          </Button>
        )}
        <Button disabled={!ready || create.isPending} onClick={() => create.mutate()}>
          {create.isPending && <Spinner data-icon="inline-start" />}
          创建会话
        </Button>
      </div>
    </FieldGroup>
  )
}
