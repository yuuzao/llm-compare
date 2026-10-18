import { z } from "zod";

export const HOME_MODES = ["overlay", "clean"] as const;
export const MOUNT_MODES = ["ro", "rw", "overlay"] as const;
export const THOUGHT_MODES = ["none", "option", "in_model"] as const;
export const CLEAN_STATUSES = ["unverified", "verified", "not_guaranteed"] as const;

const absolutePath = z.string().trim().min(1).refine((p) => p.startsWith("/"), "必须是绝对路径");
const nonEmpty = z.string().trim().min(1);

export const mountSchema = z.object({
  host_path: absolutePath,
  sandbox_path: absolutePath.nullable(),
  mode: z.enum(MOUNT_MODES),
});

export const envOverrideSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "环境变量名只能包含字母、数字和下划线，且不能以数字开头"),
  value: z.string(),
});

export const agentConfigInputSchema = z
  .object({
    name: nonEmpty.max(80),
    command: nonEmpty,
    args: z.array(z.string()),
    home_mode: z.enum(HOME_MODES),
    mounts: z.array(mountSchema),
    env: z.array(envOverrideSchema),
    model_config_id: nonEmpty.nullable(),
    thought_mode: z.enum(THOUGHT_MODES),
    thought_config_id: nonEmpty.nullable(),
    readonly_config_id: nonEmpty.nullable(),
    readonly_value: nonEmpty.nullable(),
    clean_status: z.enum(CLEAN_STATUSES),
    clean_verification_note: z.string().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.thought_mode === "option" && v.thought_config_id === null) {
      ctx.addIssue({ code: "custom", path: ["thought_config_id"], message: "思考强度使用独立配置项时必须填写配置项标识" });
    }
    if (v.thought_mode !== "option" && v.thought_config_id !== null) {
      ctx.addIssue({ code: "custom", path: ["thought_config_id"], message: "只有思考强度使用独立配置项时才能填写配置项标识" });
    }
    if (v.thought_mode !== "none" && v.model_config_id === null) {
      ctx.addIssue({ code: "custom", path: ["model_config_id"], message: "思考强度按“Agent + 模型”映射，启用思考强度时必须填写模型配置项标识" });
    }
    if ((v.readonly_config_id === null) !== (v.readonly_value === null)) {
      ctx.addIssue({ code: "custom", path: ["readonly_value"], message: "只读模式配置项与取值必须同时填写或同时留空" });
    }
    if (v.home_mode === "overlay" && v.clean_status !== "unverified") {
      ctx.addIssue({ code: "custom", path: ["clean_status"], message: "沿用全局配置模式不涉及干净环境验证" });
    }
    if (v.clean_status === "verified" && !v.clean_verification_note?.trim()) {
      ctx.addIssue({ code: "custom", path: ["clean_verification_note"], message: "标记为已验证时必须写明验证方式与结论" });
    }
    const names = new Set<string>();
    for (const [i, e] of v.env.entries()) {
      if (names.has(e.name)) ctx.addIssue({ code: "custom", path: ["env", i, "name"], message: `环境变量重复: ${e.name}` });
      names.add(e.name);
    }
  });
export type AgentConfigInput = z.infer<typeof agentConfigInputSchema>;

export const thoughtOptionsRequestSchema = z.strictObject({ model_value: nonEmpty.nullable(), refresh: z.boolean().optional() });

export const thoughtLevelInputSchema = z.object({ name: nonEmpty.max(40), sort: z.number().int() });
export type ThoughtLevelInput = z.infer<typeof thoughtLevelInputSchema>;

export const providerModelSchema = z.strictObject({
  id: nonEmpty,
  name: nonEmpty,
  images: z.boolean(),
  pdf: z.boolean(),
  thought_levels: z.record(z.string(), nonEmpty),
});
export const providerInputSchema = z.strictObject({
  name: nonEmpty.max(80),
  protocol: z.enum(["chat_completions", "responses"]),
  base_url: z.url().refine((value) => {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  }, "请输入不含认证信息、查询参数的 HTTP(S) API 基础地址"),
  api_key: nonEmpty.optional(),
  models: z.array(providerModelSchema).min(1).refine((models) => new Set(models.map((m) => m.id)).size === models.length, "模型 ID 不能重复"),
});
export type ProviderInput = z.infer<typeof providerInputSchema>;
export type ProviderModel = z.infer<typeof providerModelSchema>;

export const libraryRefSchema = z.strictObject({ id: z.string().uuid(), version: z.number().int().positive() });
export const librarySourceSchema = z.strictObject({ id: z.string().uuid(), version: z.number().int().positive(), title: nonEmpty.max(120) });
export const librarySourcesSchema = z.strictObject({ material: librarySourceSchema.optional(), prompt: librarySourceSchema.optional() });
export type LibraryRef = z.infer<typeof libraryRefSchema>;
export type LibrarySources = z.infer<typeof librarySourcesSchema>;
export const librarySaveSchema = z.strictObject({
  kind: z.enum(["material", "prompt"]), title: nonEmpty.max(120), content: z.string(),
  attachment_ids: z.array(z.string().uuid()).max(10).default([]),
  source_project_id: z.string().uuid().optional(), source_attachment_ids: z.array(z.string().uuid()).max(10).default([]),
  expected_version: z.number().int().positive().optional(),
});
export type LibrarySaveInput = z.infer<typeof librarySaveSchema>;
export const libraryQuerySchema = z.strictObject({ kind: z.enum(["material", "prompt"]), query: z.string().default(""), include_deleted: z.enum(["true", "false"]).optional(), limit: z.coerce.number().int().min(1).max(100).default(30), cursor: z.string().optional() });
export const projectCreateSchema = z.strictObject({ title: nonEmpty.max(120), material_ref: libraryRefSchema.optional(), prompt_ref: libraryRefSchema.optional() });
export const projectPatchSchema = z
  .object({
    title: nonEmpty.max(120).optional(),
    draft_material: z.string().optional(),
    draft_prompt: z.string().optional(),
    draft_attachment_ids: z.array(z.string().uuid()).max(10).optional(),
    draft_sources: librarySourcesSchema.optional(),
    expected_draft_version: z.number().int().nonnegative(),
  })
  .refine((v) => v.title !== undefined || v.draft_material !== undefined || v.draft_prompt !== undefined || v.draft_attachment_ids !== undefined || v.draft_sources !== undefined, "至少修改一个字段");
export type ProjectPatch = z.infer<typeof projectPatchSchema>;

const runCommon = {
  idempotency_key: z.string().uuid(),
  material: z.string(),
  attachment_ids: z.array(z.string().uuid()).max(10),
  prompt: z.string().refine((s) => s.trim().length > 0, "提示词不能为空"),
  source_run_id: nonEmpty.nullable(),
  require_clean: z.boolean(),
  library_sources: librarySourcesSchema.optional(),
};

export const createRunSchema = z.strictObject({
  ...runCommon,
  targets: z.array(z.union([
    z.strictObject({ agent_config_id: nonEmpty, model: nonEmpty.nullable(), thought_value: nonEmpty.nullable(), model_parameters: z.record(nonEmpty, nonEmpty).optional() }),
    z.strictObject({ provider_id: nonEmpty, model: nonEmpty, thought_level_id: nonEmpty.nullable() }),
  ])).min(1).max(4),
});
export type CreateRunInput = z.infer<typeof createRunSchema>;

export const runPatchSchema = z.object({ title: nonEmpty.max(200) });

export const deleteRunQuerySchema = z.object({ permanent: z.enum(["true", "false"]).optional() });

export const conversationScopeSchema = z.object({
  run_ids: z.array(nonEmpty).min(1).max(50),
});
export type ConversationScope = z.infer<typeof conversationScopeSchema>;

export const conversationCreateSchema = z.object({
  project_id: nonEmpty,
  agent_config_id: nonEmpty,
  model: nonEmpty.nullable(),
  thought_value: nonEmpty.nullable(),
  model_parameters: z.record(nonEmpty, nonEmpty).optional(),
  scope: conversationScopeSchema,
});
export type ConversationCreateInput = z.infer<typeof conversationCreateSchema>;

export const conversationPatchSchema = z.object({ scope: conversationScopeSchema });

export const messageCreateSchema = z.object({
  content: z.string().refine((s) => s.trim().length > 0, "消息不能为空"),
});

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export const projectListQuerySchema = listQuerySchema.extend({ query: z.string().optional(), include_deleted: z.enum(["true", "false"]).optional() }).strict();

export const runListQuerySchema = listQuerySchema.extend({
  target_id: z.string().optional(),
  created_after: z.string().datetime({ offset: true }).optional(),
  created_before: z.string().datetime({ offset: true }).optional(),
  query: z.string().optional(),
  include_deleted: z.enum(["true", "false"]).optional(),
}).strict();

export const contentQuerySchema = z.object({
  revision: z.coerce.number().int().nonnegative().optional(),
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(200_000).default(20_000),
});
