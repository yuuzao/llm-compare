import { memo } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

const components: Components = {
  h1: (p) => <h1 className="mt-4 mb-2 text-lg font-semibold first:mt-0" {...p} />,
  h2: (p) => <h2 className="mt-4 mb-2 text-base font-semibold first:mt-0" {...p} />,
  h3: (p) => <h3 className="mt-3 mb-1.5 font-semibold first:mt-0" {...p} />,
  h4: (p) => <h4 className="mt-3 mb-1 font-medium first:mt-0" {...p} />,
  p: (p) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0" {...p} />,
  ul: (p) => <ul className="my-2 flex list-disc flex-col gap-1 pl-5" {...p} />,
  ol: (p) => <ol className="my-2 flex list-decimal flex-col gap-1 pl-5" {...p} />,
  blockquote: (p) => <blockquote className="my-2 border-l-2 pl-3 text-muted-foreground" {...p} />,
  a: (p) => <a className="text-primary underline underline-offset-4" target="_blank" rel="noreferrer noopener" {...p} />,
  hr: () => <hr className="my-3 border-border" />,
  table: (p) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...p} />
    </div>
  ),
  th: (p) => <th className="border px-2 py-1 text-left font-medium" {...p} />,
  td: (p) => <td className="border px-2 py-1 align-top" {...p} />,
  pre: (p) => <pre className="my-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed" {...p} />,
  code: ({ className, ...p }) =>
    className ? <code className={className} {...p} /> : <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...p} />,
}

/** react-markdown 默认不渲染原始 HTML，模型输出中的 HTML 会作为文本显示。 */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="min-w-0 text-sm break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
