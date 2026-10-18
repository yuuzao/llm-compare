import { LibraryBigIcon, BotIcon, CableIcon, FolderIcon, GaugeIcon, MoreHorizontalIcon, PlusIcon, SearchIcon } from "lucide-react"
import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import type { ProjectSummary } from "@llm-compare/shared"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Checkbox } from "@/components/ui/checkbox"
import { api, errorMessage } from "@/lib/api"
import { NavLink, Outlet, useParams } from "react-router"
import { EmptyState, ErrorState, LoadingRows } from "@/components/common/states"
import { NewProjectDialog } from "@/components/project/new-project-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { useDebounced } from "@/hooks/use-debounced"
import { useProjects } from "@/lib/queries"
import { cn } from "@/lib/utils"

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-4 [&_svg]:shrink-0",
    isActive && "bg-muted font-medium text-foreground",
  )

export function AppShell() {
  const [search, setSearch] = useState("")
  const query = useDebounced(search.trim(), 300)
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null)
  const projects = useProjects(query, includeDeleted)
  const { projectId } = useParams()
  const [creating, setCreating] = useState(false)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const removeProject = useMutation({
    mutationFn: (id: string) => api.del(`/projects/${id}`),
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: ["projects"] })
      void qc.invalidateQueries({ queryKey: ["project", id] })
      setDeleteTarget(null)
      toast.success("项目已移入回收站")
      if (id === projectId) void navigate("/")
    },
    onError: (error) => toast.error(`删除项目失败：${errorMessage(error)}`),
  })
  const restoreProject = useMutation({
    mutationFn: (id: string) => api.post<ProjectSummary>(`/projects/${id}/restore`, {}),
    onSuccess: (project) => {
      void qc.invalidateQueries({ queryKey: ["projects"] })
      toast.success("项目已恢复")
      if (project.id === projectId) void navigate(`/projects/${project.id}`)
    },
    onError: (error) => toast.error(`恢复项目失败：${errorMessage(error)}`),
  })

  return (
    <div className="flex h-svh overflow-hidden bg-background">
      <aside className="flex w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="flex flex-col gap-1 p-3">
          <div className="px-2 pb-2 text-sm font-semibold">LLM 对比工作台</div>
          <NavLink to="/library" className={navClass}><LibraryBigIcon />内容库</NavLink>
          <NavLink to="/settings/agents" className={navClass}>
            <BotIcon />
            Agent 设置
          </NavLink>
          <NavLink to="/settings/providers" className={navClass}><CableIcon />API Provider</NavLink>
          <NavLink to="/settings/thought" className={navClass}>
            <GaugeIcon />
            思考强度
          </NavLink>
        </div>
        <Separator />
        <div className="flex flex-col gap-2 p-3">
          <div className="flex items-center justify-between px-2">
            <span className="text-xs font-medium text-muted-foreground">项目</span>
            <Button size="icon-sm" variant="ghost" aria-label="新建项目" onClick={() => setCreating(true)}>
              <PlusIcon />
            </Button>
          </div>
          <label htmlFor="show-deleted-projects" className="flex items-center gap-2 px-2 pt-1 text-xs text-muted-foreground">
            <Checkbox id="show-deleted-projects" checked={includeDeleted} onCheckedChange={(checked) => setIncludeDeleted(checked === true)} />
            显示回收站
          </label>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="搜索项目" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <ScrollArea className="min-h-0 min-w-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
          <nav className="flex flex-col gap-0.5 px-3 pb-3">
            {projects.isPending ? (
              <LoadingRows rows={4} />
            ) : projects.isError ? (
              <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />
            ) : projects.data.items.length === 0 ? (
              <EmptyState title={query ? "没有匹配的项目" : "还没有项目"} description={query ? undefined : "新建一个项目开始对比"} icon={FolderIcon} />
            ) : (
              projects.data.items.map((p) => (
                <div key={p.id} className="group flex min-w-0 items-center gap-1">
                  {p.deleted ? (
                    <span className={cn(navClass({ isActive: false }), "min-w-0 flex-1 cursor-default")}>
                      <FolderIcon />
                      <span className="min-w-0 flex-1 truncate">{p.title}</span>
                      <span className="shrink-0 rounded bg-muted px-1 text-[10px]">回收站</span>
                    </span>
                  ) : (
                    <NavLink to={`/projects/${p.id}`} className={() => cn(navClass({ isActive: p.id === projectId }), "min-w-0 flex-1")}>
                      <FolderIcon />
                      <span className="min-w-0 flex-1 truncate">{p.title}</span>
                    </NavLink>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon-sm" variant="ghost" aria-label={`项目操作 ${p.title}`} title="项目操作"><MoreHorizontalIcon /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {p.deleted ? (
                        <DropdownMenuItem disabled={restoreProject.isPending} onSelect={() => restoreProject.mutate(p.id)}>恢复项目</DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem variant="destructive" onSelect={() => setDeleteTarget(p)}>移入回收站</DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))
            )}
          </nav>
        </ScrollArea>
      </aside>
      <main className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
      <NewProjectDialog open={creating} onOpenChange={setCreating} />
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open && !removeProject.isPending) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>将“{deleteTarget?.title}”移入回收站？</AlertDialogTitle>
            <AlertDialogDescription>项目会从默认列表中隐藏，已有轮次、分析记录和附件都会保留。勾选“显示回收站”后可以恢复项目。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeProject.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={removeProject.isPending} onClick={(event) => { event.preventDefault(); if (deleteTarget) removeProject.mutate(deleteTarget.id) }}>
              {removeProject.isPending ? "正在删除…" : "移入回收站"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
