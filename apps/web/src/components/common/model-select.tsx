import { Command } from "cmdk"
import { cn } from "cn"
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react"
import { Popover } from "radix-ui"
import { useState } from "react"
import { Button } from "@/components/ui/button"

type Option = { value: string; name: string }
type Props = { options: readonly Option[]; value: string; onValueChange: (value: string) => void; label?: string; placeholder?: string; disabled?: boolean }

export function ModelSelect({ options, value, onValueChange, label = "模型", placeholder = "选择模型", disabled = false }: Props) {
  const [open, setOpen] = useState(false)
  const selected = options.find((o) => o.value === value)
  const missing = !!value && !selected
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild>
      <Button type="button" role="combobox" aria-label={label} title={selected?.name ?? (value || undefined)} aria-expanded={open} aria-haspopup="listbox" variant="outline" disabled={disabled} onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true) }
      }} className="w-full min-w-0 justify-between font-normal">
        <span className={cn("truncate", !value && "text-muted-foreground")}>{selected?.name ?? (missing ? `${value}（不可用）` : placeholder)}</span>
        <ChevronDownIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </Button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content align="start" sideOffset={4} className="z-50 w-[max(18rem,var(--radix-popover-trigger-width))] max-w-(--radix-popover-content-available-width) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10">
        <Command label={`搜索${label}`} defaultValue={value} filter={(id, search, keywords) => {
          const query = search.trim().toLowerCase()
          return [id, ...(keywords ?? [])].some((text) => text.toLowerCase().includes(query)) ? 1 : 0
        }}>
          <div className="flex items-center gap-2 border-b px-2.5 py-1.5">
            <SearchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <Command.Input aria-label={`搜索${label}`} placeholder="搜索模型名称或标识…" className="h-8 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          </div>
          <Command.List label={`${label}选项`} className="max-h-[min(20rem,calc(var(--radix-popover-content-available-height)_-_3rem))] scroll-py-1 overflow-y-auto overscroll-contain p-1">
            <Command.Empty className="px-2 py-6 text-center text-sm text-muted-foreground">没有匹配的模型</Command.Empty>
            {missing && <Command.Item value={value} disabled className="px-1.5 py-1 text-sm opacity-50">{value}（不可用）</Command.Item>}
            {options.map((o) => <Command.Item key={o.value} value={o.value} keywords={[o.name]} title={`${o.name}\n${o.value}`} onSelect={() => {
              if (o.value !== value) onValueChange(o.value)
              setOpen(false)
            }} className="relative flex cursor-default items-center rounded-md py-1.5 pr-8 pl-1.5 text-sm outline-none select-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground">
              <span className="truncate">{o.name}</span>
              <CheckIcon aria-hidden className={cn("absolute right-2 size-4", value === o.value ? "opacity-100" : "opacity-0")} />
            </Command.Item>)}
          </Command.List>
        </Command>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
}
