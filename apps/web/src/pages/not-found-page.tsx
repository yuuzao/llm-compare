import { FileQuestionIcon } from "lucide-react"
import { Link } from "react-router"
import { EmptyState } from "@/components/common/states"
import { Button } from "@/components/ui/button"

export function NotFoundPage() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <EmptyState title="页面不存在" icon={FileQuestionIcon}>
        <Button asChild variant="outline">
          <Link to="/">返回首页</Link>
        </Button>
      </EmptyState>
    </div>
  )
}
