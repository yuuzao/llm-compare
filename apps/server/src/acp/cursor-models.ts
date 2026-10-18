import type { ClientSideConnection } from "@agentclientprotocol/sdk";
import type { ConfigOptionValue, ModelCatalogEntry } from "@llm-compare/shared";
import { z } from "zod";

const valueSchema = z.object({ value: z.string(), name: z.string() });
const optionSchema = z.object({
  id: z.string().min(1), name: z.string(), category: z.string().nullish(),
  type: z.literal("select"), currentValue: z.string(),
  options: z.array(z.union([valueSchema, z.object({ group: z.string(), name: z.string(), options: z.array(valueSchema) })])),
});
const catalogSchema = z.object({ models: z.array(z.object({
  value: z.string().min(1), name: z.string(), configOptions: z.array(optionSchema),
})).min(1).refine((models) => new Set(models.map((m) => m.value)).size === models.length) });

export function hasCursorModelCatalog(authMethods: unknown[]): boolean {
  return authMethods.some((a) => a !== null && typeof a === "object" && "id" in a && a.id === "cursor_login");
}

export function parseCursorModelCatalog(raw: unknown): ModelCatalogEntry[] {
  const parsed = catalogSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Cursor 返回的模型目录格式无效");
  return parsed.data.models.map((m) => ({ value: m.value, name: m.name, config_options: m.configOptions.map((o) => ({
    id: o.id, name: o.name, category: o.category ?? null, type: o.type, current_value: o.currentValue,
    values: o.options.flatMap((v): ConfigOptionValue[] => "group" in v ? v.options.map((x) => ({ ...x, group: v.name })) : [{ ...v, group: null }]),
  })) }));
}

export async function readCursorModelCatalog(conn: ClientSideConnection): Promise<ModelCatalogEntry[]> {
  return parseCursorModelCatalog(await conn.extMethod("cursor/list_available_models", {}));
}
