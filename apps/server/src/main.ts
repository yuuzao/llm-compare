import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { buildSandboxHost, stderrDirFor, type AppContext } from "./context.ts";
import { loadConfig } from "./config.ts";
import { openDb } from "./db/index.ts";
import { buildApp } from "./http/app.ts";
import { loadUiToken } from "./http/security.ts";
import { logger } from "./logger.ts";
import { AgentService } from "./services/agents.ts";
import { ConversationService, recoverMessages } from "./services/conversations.ts";
import { EventStore } from "./services/events.ts";
import { AttemptExecutor, recoverInterrupted } from "./services/executor.ts";
import { MappingService } from "./services/mappings.ts";
import { ProjectService } from "./services/projects.ts";
import { RunService } from "./services/runs.ts";
import { Scheduler } from "./services/scheduler.ts";
import { assertWorkRootSafe, WorkDirs } from "./services/workdir.ts";

export function startServer(configArg: string) {
const configPath = resolve(configArg);
const config = loadConfig(configPath);
const sandboxHost = buildSandboxHost(config);
assertWorkRootSafe(config.work_root, sandboxHost.home);

const db = openDb(config.data_dir, config.work_root);
const ctx: AppContext = {
  config,
  db,
  events: new EventStore(db),
  workdirs: new WorkDirs(config.work_root),
  sandboxHost,
  scheduler: new Scheduler(config.scheduler.max_parallel_processes),
  stderrDir: stderrDirFor(config),
};

const projects = new ProjectService(ctx);
const agents = new AgentService(ctx);
const mappings = new MappingService(ctx);
const runs = new RunService(ctx, projects, agents, mappings);
const executor = new AttemptExecutor(ctx, runs, agents);
runs.launcher = executor;
const conversations = new ConversationService(ctx, projects, agents, mappings, runs);

recoverInterrupted(ctx, runs);
recoverMessages(ctx);

const app = buildApp(ctx, { agents, mappings, projects, runs, conversations }, loadUiToken(config.data_dir));
let stopping = false;
const server = serve({ fetch: (request) => {
  if (stopping && !["GET", "HEAD"].includes(request.method)) return new Response("服务正在停止", { status: 503 });
  return app.fetch(request);
}, hostname: config.server.host, port: config.server.port }, (info) => {
  logger.info({ address: info.address, port: info.port, config: configPath, workRoot: config.work_root, dataDir: config.data_dir }, "llm-compare 后端已启动");
});

const shutdown = () => {
  if (stopping) return;
  stopping = true;
  ctx.scheduler.pause();
  logger.info("正在停止服务并取消未完成任务");
  server.close();
  for (const { id } of db.all<{ id: string }>("SELECT id FROM attempts WHERE status IN ('queued','running','cancel_requested')")) executor.cancel(id);
  for (const { conversation_id } of db.all<{ conversation_id: string }>("SELECT DISTINCT conversation_id FROM messages WHERE status = 'generating'")) {
    try { conversations.cancel(conversation_id); }
    catch (error) { logger.warn({ err: String(error) }, "停止分析会话失败"); }
  }
  const deadline = setTimeout(() => {
    logger.error("停止等待超时，未完成任务将在下次启动时标记中断");
    process.exit(1);
  }, config.timeouts.cancel_confirm_ms + 5000);
  void ctx.scheduler.whenIdle().then(() => {
    clearTimeout(deadline);
    db.raw.close();
    logger.info("服务已停止");
    process.exit(0);
  });
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
return { server, shutdown };
}
