import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const absolute = z.string().refine(isAbsolute, "必须是绝对路径");
const positiveInt = z.number().int().positive();

const configSchema = z.strictObject({
  server: z.strictObject({
    host: z.enum(["127.0.0.1", "::1"]),
    port: z.number().int().min(1).max(65535),
  }),
  data_dir: absolute,
  work_root: absolute,
  bwrap_path: absolute,
  web_dist_dir: z.union([z.literal("embedded"), absolute]).nullable(),
  scheduler: z.strictObject({ max_parallel_processes: positiveInt }),
  timeouts: z.strictObject({
    startup_ms: positiveInt,
    attempt_ms: positiveInt,
    cancel_confirm_ms: positiveInt,
    probe_ms: positiveInt,
  }),
  limits: z.strictObject({ max_output_chars: positiveInt, max_attachment_bytes: positiveInt, max_attachments_total_bytes: positiveInt }),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(path: string): AppConfig {
  const raw = parse(readFileSync(path, "utf8"));
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join(".") || "(根)"}: ${i.message}`).join("; ");
    throw new Error(`配置文件 ${path} 无效: ${detail}`);
  }
  return result.data;
}
