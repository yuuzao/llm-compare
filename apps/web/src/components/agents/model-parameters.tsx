import type { ConfigOptionView } from "@llm-compare/shared"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function parameterValues(
  options: ConfigOptionView[],
  selected: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    options.map((o) => [o.id, selected[o.id] ?? o.current_value ?? ""])
  )
}

export function validParameters(
  options: ConfigOptionView[],
  selected: Record<string, string>
): boolean {
  return (
    Object.keys(selected).every((id) => options.some((o) => o.id === id)) &&
    options.every((o) =>
      o.values.some((v) => v.value === (selected[o.id] ?? o.current_value))
    )
  )
}

const labels: Record<string, string> = {
  context: "上下文大小",
  fast: "快速模式",
  thinking: "思考开关",
}

export function ModelParameters({
  options,
  value,
  onChange,
  disabled = false,
  compact = false,
}: {
  options: ConfigOptionView[]
  value: Record<string, string>
  onChange: (v: Record<string, string>) => void
  disabled?: boolean
  compact?: boolean
}) {
  return options.map((o) => {
    const label = labels[o.id] ?? o.name
    const selected = value[o.id] ?? o.current_value ?? ""
    const missing = !!selected && !o.values.some((v) => v.value === selected)
    return (
      <Field key={o.id} className="min-w-0">
        {!compact && <FieldLabel>{label}</FieldLabel>}
        <Select
          value={selected}
          disabled={disabled}
          onValueChange={(v) => onChange({ ...value, [o.id]: v })}
        >
          <SelectTrigger
            className="w-full min-w-0 [&>span]:truncate"
            aria-label={label}
          >
            <SelectValue placeholder={label}>
              {compact
                ? `${label}：${o.values.find((v) => v.value === selected)?.name ?? selected}`
                : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {missing && (
              <SelectItem value={selected} disabled>
                {selected}（不可用）
              </SelectItem>
            )}
            {o.values.map((v) => (
              <SelectItem key={v.value} value={v.value}>
                {v.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    )
  })
}
