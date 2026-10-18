import type { ProjectView } from "@llm-compare/shared"
import { MessageSquareTextIcon, PlayIcon } from "lucide-react"
import { useState } from "react"
import { useParams, useSearchParams } from "react-router"
import { AnalysisSheet } from "@/components/analysis/analysis-sheet"
import { EmptyState, ErrorState, LoadingRows } from "@/components/common/states"
import { DraftEditor, DraftStatus } from "@/components/project/draft-editor"
import { HistoryList } from "@/components/project/history-list"
import { RunComposer } from "@/components/project/run-composer"
import { RunResults } from "@/components/run/run-results"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useDraft } from "@/hooks/use-draft"
import { useProject, useRun, useRuns } from "@/lib/queries"

const PAGE_NOTE =
  "每个对象可独立选择 Agent 或 API Provider 及其模型。所有对象接收相同的素材、附件和提示词，思考强度由每个对象独立设置。Agent 自带上下文、联网和读取类工具行为视为其自身能力；Agent 只返回文本结果，不允许修改本地文件或执行命令。修改输入后运行会创建新记录。"

export function ProjectPage() {
  const { projectId } = useParams()
  const project = useProject(projectId!)
  if (project.isPending)
    return (
      <div className="p-6">
        <LoadingRows rows={6} />
      </div>
    )
  if (project.isError)
    return (
      <div className="p-6">
        <ErrorState
          title="项目加载失败"
          error={project.error}
          onRetry={() => void project.refetch()}
        />
      </div>
    )
  return <Workspace key={project.data.id} project={project.data} />
}

function Workspace({ project }: { project: ProjectView }) {
  const [params, setParams] = useSearchParams()
  const draft = useDraft(project)
  const fromId = params.get("from")
  const source = useRun(fromId)
  const latest = useRuns(project.id, { query: "", include_deleted: false })
  const shownRun =
    params.get("run") ?? latest.data?.pages[0]?.items[0]?.id ?? null
  const tab = params.get("tab") ?? "results"
  const [uploadBusy, setUploadBusy] = useState(false)
  const [analysisOpen, setAnalysisOpen] = useState(false)

  const setParam = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) next.delete(k)
          else next.set(k, v)
        }
        return next
      },
      { replace: true }
    )

  return (
    <div className="h-full min-h-0 min-w-0">
      <ResizablePanelGroup orientation="vertical" className="min-h-0 min-w-0">
        <ResizablePanel
          id="configuration"
          defaultSize="35%"
          minSize="20%"
          maxSize="70%"
        >
          <section
            aria-label="配置栏"
            className="flex h-full min-h-0 min-w-0 flex-col"
          >
            <div className="flex shrink-0 items-center gap-2 px-4 py-2">
              <h1 className="min-w-0 flex-1 truncate text-base font-semibold">
                {project.title}
              </h1>
              <DraftStatus draft={draft} />
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAnalysisOpen(true)}
              >
                <MessageSquareTextIcon data-icon="inline-start" />
                分析
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
                <div className="min-w-0">
                  <DraftEditor
                    draft={draft}
                    projectId={project.id}
                    onBusy={setUploadBusy}
                  />
                </div>
                <div className="min-w-0 border-t pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-4">
                  {fromId && source.isPending ? (
                    <LoadingRows rows={3} />
                  ) : fromId && source.isError ? (
                    <ErrorState
                      title="来源轮次加载失败"
                      error={source.error}
                      onRetry={() => void source.refetch()}
                    />
                  ) : (
                    <RunComposer
                      key={fromId ?? "fresh"}
                      projectId={project.id}
                      material={draft.material}
                      sources={draft.sources}
                      prompt={draft.prompt}
                      attachments={draft.attachments}
                      uploadBusy={uploadBusy}
                      preset={
                        fromId && source.data ? { source: source.data } : null
                      }
                      onCreated={(run) =>
                        setParam({ run: run.id, tab: "results", from: null })
                      }
                    />
                  )}
                </div>
              </div>
            </div>
          </section>
        </ResizablePanel>
        <ResizableHandle
          withHandle
          aria-label="调整配置栏与结果栏高度"
          className="aria-[orientation=horizontal]:h-2"
        />
        <ResizablePanel id="results" defaultSize="65%" minSize="30%">
          <section
            aria-label="结果栏"
            className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto p-4"
          >
            <Tabs
              value={tab}
              onValueChange={(v) => setParam({ tab: v })}
              className="flex shrink-0 flex-col"
            >
              <TabsList>
                <TabsTrigger value="results">本轮结果</TabsTrigger>
                <TabsTrigger value="history">历史</TabsTrigger>
              </TabsList>
              <TabsContent value="results" className="flex flex-col gap-3">
                <Alert>
                  <AlertTitle>运行说明</AlertTitle>
                  <AlertDescription>{PAGE_NOTE}</AlertDescription>
                </Alert>
                {shownRun ? (
                  <RunResults key={shownRun} runId={shownRun} />
                ) : latest.isPending ? (
                  <LoadingRows rows={3} />
                ) : latest.isError ? (
                  <ErrorState
                    error={latest.error}
                    onRetry={() => void latest.refetch()}
                  />
                ) : (
                  <EmptyState
                    title="还没有运行"
                    description="在上方填写提示词、选择对比对象后点击运行。"
                    icon={PlayIcon}
                  />
                )}
              </TabsContent>
              <TabsContent value="history">
                <HistoryList projectId={project.id} />
              </TabsContent>
            </Tabs>
          </section>
        </ResizablePanel>
      </ResizablePanelGroup>
      <AnalysisSheet
        projectId={project.id}
        open={analysisOpen}
        onOpenChange={setAnalysisOpen}
        suggestedRunId={shownRun}
      />
    </div>
  )
}
