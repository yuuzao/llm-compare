import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { SandboxHost } from "./acp/sandbox.ts";
import type { AppConfig } from "./config.ts";
import type { Db } from "./db/index.ts";
import type { EventStore } from "./services/events.ts";
import type { Scheduler } from "./services/scheduler.ts";
import type { WorkDirs } from "./services/workdir.ts";

export type AppContext = {
  config: AppConfig;
  db: Db;
  events: EventStore;
  workdirs: WorkDirs;
  sandboxHost: SandboxHost;
  scheduler: Scheduler;
  stderrDir: string;
};

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`环境变量 ${name} 未设置，无法构建沙箱环境`);
  return v;
}

export function buildSandboxHost(config: AppConfig): SandboxHost {
  if (!existsSync(config.bwrap_path)) throw new Error(`bwrap 不存在: ${config.bwrap_path}`);
  return {
    bwrapPath: config.bwrap_path,
    home: requiredEnv("HOME"),
    user: requiredEnv("USER"),
    path: requiredEnv("PATH"),
    lang: process.env.LANG ?? null,
    exists: existsSync,
  };
}

export function stderrDirFor(config: AppConfig): string {
  const dir = join(config.data_dir, "agent-stderr");
  mkdirSync(dir, { recursive: true });
  return dir;
}
