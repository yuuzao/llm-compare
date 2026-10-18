import { FolderOpenIcon } from "lucide-react"
import { useState } from "react"
import { EmptyState } from "@/components/common/states"
import { NewProjectDialog } from "@/components/project/new-project-dialog"
import { Button } from "@/components/ui/button"

export function HomePage() {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex h-full items-center justify-center p-6">
      <EmptyState title="选择或新建一个项目" description="项目保存素材、提示词草稿和每一轮对比记录。" icon={FolderOpenIcon}>
        <Button onClick={() => setOpen(true)}>新建项目</Button>
      </EmptyState>
      <NewProjectDialog open={open} onOpenChange={setOpen} />
    </div>
  )
}
