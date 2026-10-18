import type {
  AgentConfigView,
  ConversationView,
  MessageView,
  ModelOptionView,
  Page,
  ProjectSummary,
  ProjectView,
  ProviderView,
  RunPacket,
  RunSummary,
  ThoughtLevelView,
  ThoughtOptionsResult,
} from "@llm-compare/shared"
import { keepPreviousData, useInfiniteQuery, useQuery, type QueryClient } from "@tanstack/react-query"
import { api, qs } from "./api"

export const keys = {
  projects: (q: string) => ["projects", q] as const,
  project: (id: string) => ["project", id] as const,
  runs: (projectId: string) => ["runs", projectId] as const,
  run: (id: string) => ["run", id] as const,
  agents: ["agents"] as const,
  providers: ["providers"] as const,
  models: (agentId: string) => ["models", agentId] as const,
  levels: ["thought-levels"] as const,
  conversations: (projectId: string) => ["conversations", projectId] as const,
  messages: (convId: string) => ["messages", convId] as const,
}

export const useProjects = (query: string, includeDeleted = false) =>
  useQuery({
    queryKey: [...keys.projects(query), includeDeleted],
    queryFn: () => api.get<Page<ProjectSummary>>(`/projects${qs({ query, limit: 100, include_deleted: includeDeleted ? "true" : undefined })}`),
    placeholderData: keepPreviousData,
  })

export const useProject = (id: string) => useQuery({ queryKey: keys.project(id), queryFn: () => api.get<ProjectView>(`/projects/${id}`) })

export type RunFilter = { query: string; include_deleted: boolean }

export const useRuns = (projectId: string, f: RunFilter) =>
  useInfiniteQuery({
    queryKey: [...keys.runs(projectId), f],
    queryFn: ({ pageParam }) =>
      api.get<Page<RunSummary>>(
        `/projects/${projectId}/runs${qs({ query: f.query, include_deleted: f.include_deleted ? "true" : undefined, cursor: pageParam, limit: 20 })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
  })

export const useRun = (id: string | null) =>
  useQuery({ queryKey: keys.run(id ?? ""), queryFn: () => api.get<RunPacket>(`/runs/${id}`), enabled: id !== null })

export const useAgents = () => useQuery({ queryKey: keys.agents, queryFn: () => api.get<{ items: AgentConfigView[] }>("/agent-configs").then((r) => r.items) })

export const useModels = (agentId: string | null) =>
  useQuery({
    queryKey: keys.models(agentId ?? ""),
    queryFn: () => api.get<{ items: ModelOptionView[] }>(`/agent-configs/${agentId}/models`).then((r) => r.items),
    enabled: agentId !== null,
  })

export const useLevels = () => useQuery({ queryKey: keys.levels, queryFn: () => api.get<{ items: ThoughtLevelView[] }>("/thought-levels").then((r) => r.items) })

export function thoughtOptionsQuery(agent: AgentConfigView | undefined | null, model: string | null) {
  return {
    queryKey: ["agent-thought-options", agent?.id, agent?.updated_at, agent?.probe?.probed_at, model] as const,
    queryFn: () => api.post<ThoughtOptionsResult>(`/agent-configs/${agent!.id}/thought-options`, { model_value: model }),
    enabled: !!agent?.available && (!agent.model_config_id || !!model),
    staleTime: Infinity,
    retry: false,
  }
}
export const useThoughtOptions = (agent: AgentConfigView | undefined | null, model: string | null) => useQuery(thoughtOptionsQuery(agent, model))

export async function refreshThoughtOptions(qc: QueryClient, agent: AgentConfigView, model: string | null) {
  await qc.invalidateQueries({ queryKey: ["agent-thought-options", agent.id], refetchType: "none" })
  return qc.fetchQuery({
    ...thoughtOptionsQuery(agent, model), staleTime: 0,
    queryFn: () => api.post<ThoughtOptionsResult>(`/agent-configs/${agent.id}/thought-options`, { model_value: model, refresh: true }),
  })
}

export const useConversations = (projectId: string) =>
  useQuery({
    queryKey: keys.conversations(projectId),
    queryFn: () => api.get<Page<ConversationView>>(`/projects/${projectId}/conversations`).then((r) => r.items),
  })

export const useMessages = (convId: string | null) =>
  useQuery({
    queryKey: keys.messages(convId ?? ""),
    queryFn: async () => {
      const all: MessageView[] = []
      let cursor: string | null = null
      do {
        const page: Page<MessageView> = await api.get<Page<MessageView>>(`/conversations/${convId}/messages${qs({ cursor, limit: 200 })}`)
        all.push(...page.items)
        cursor = page.next_cursor
      } while (cursor !== null)
      return all
    },
    enabled: convId !== null,
  })

export const useProviders = () => useQuery({ queryKey: keys.providers, queryFn: () => api.get<{ items: ProviderView[] }>("/providers").then((r) => r.items) })
