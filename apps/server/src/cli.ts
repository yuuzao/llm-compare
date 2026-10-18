import { constants, accessSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir, userInfo } from "node:os";
import { spawnSync } from "node:child_process";
import { isSea } from "node:sea";
import { DatabaseSync } from "node:sqlite";
import { stringify } from "yaml";
import { loadConfig } from "./config.ts";
import { startServer } from "./main.ts";
import { assertWorkRootSafe } from "./services/workdir.ts";
import { buildInfo } from "./version.ts";

const help = `llm-compare ${buildInfo.version}
用法：
  llm-compare serve --config <配置路径>
  llm-compare init --config <配置路径>
  llm-compare doctor --config <配置路径>
  llm-compare --version
源码运行兼容：node src/cli.ts <配置路径>`;

// Bare names resolve through PATH, matching how the sandbox launches them.
function resolveExecutable(command: string): string | null {
  const candidates = command.includes("/") ? [command] : (process.env.PATH ?? "").split(":").filter(Boolean).map((dir) => join(dir, command));
  for (const candidate of candidates) {
    try { accessSync(candidate, constants.X_OK); return candidate; } catch { /* try next PATH entry */ }
  }
  return null;
}

function run(args: string[]): void {
  if (args.length === 1 && ["--version", "-v"].includes(args[0]!)) {
    console.log(JSON.stringify({ ...buildInfo, node: process.version })); return;
  }
  if (!args.length || args.some((a) => ["--help", "-h"].includes(a))) { console.log(help); return; }
  if (args.length === 1 && !["serve", "init", "doctor"].includes(args[0]!)) { startServer(args[0]!); return; }
  const [command, flag, file, ...extra] = args;
  if (!["serve", "init", "doctor"].includes(command ?? "") || flag !== "--config" || !file || extra.length) throw new Error(help);
  const path = resolve(file);
  if (command === "init") {
    if (existsSync(path)) throw new Error(`配置已存在，拒绝覆盖：${path}`);
    const home = homedir();
    const config = {
      server: { host: "127.0.0.1", port: 4310 },
      data_dir: join(process.env.XDG_DATA_HOME ?? join(home, ".local/share"), "llm-compare"),
      work_root: `/var/tmp/llm-compare-${userInfo().uid}`,
      bwrap_path: "/usr/bin/bwrap", web_dist_dir: isSea() ? "embedded" : null,
      scheduler: { max_parallel_processes: 4 },
      timeouts: { startup_ms: 90000, attempt_ms: 1800000, cancel_confirm_ms: 10000, probe_ms: 120000 },
      limits: { max_attachment_bytes: 10485760, max_attachments_total_bytes: 20971520, max_output_chars: 2000000 },
    };
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, stringify(config), { mode: 0o600, flag: "wx" });
    console.log(`已创建配置：${path}`); return;
  }
  if (command === "serve") { startServer(path); return; }
  const config = loadConfig(path);
  assertWorkRootSafe(config.work_root, homedir());
  accessSync(config.bwrap_path, constants.X_OK);
  const sandbox = spawnSync(config.bwrap_path, ["--unshare-pid", "--ro-bind", "/", "/", "--proc", "/proc", "--dev", "/dev", "--", "/usr/bin/true"], { encoding: "utf8", timeout: 10000 });
  if (sandbox.error || sandbox.status !== 0) throw new Error(`bubblewrap 检查失败：${sandbox.error?.message ?? sandbox.stderr.trim()}`);
  if (config.web_dist_dir === "embedded" && !isSea()) throw new Error("源码运行不支持 embedded 前端");
  if (config.web_dist_dir && config.web_dist_dir !== "embedded") accessSync(join(config.web_dist_dir, "index.html"), constants.R_OK);
  for (const dir of [config.data_dir, config.work_root]) {
    let existing = dir;
    while (!existsSync(existing)) existing = dirname(existing);
    accessSync(existing, constants.W_OK);
  }
  const database = join(config.data_dir, "llm-compare.sqlite");
  if (existsSync(database)) {
    const db = new DatabaseSync(database, { readOnly: true });
    try {
      const rows = db.prepare("SELECT name, config_json FROM agent_configs WHERE deleted_at IS NULL").all();
      for (const row of rows) {
        const agent = JSON.parse(String(row.config_json)) as { command: string; mounts: Array<{ host_path: string }> };
        const command = resolveExecutable(agent.command);
        if (!command) throw new Error(`Agent「${row.name}」的程序不可执行：${agent.command}（PATH=${process.env.PATH ?? ""}）`);
        for (const mount of agent.mounts) accessSync(mount.host_path, constants.R_OK);
        console.log(`Agent 程序可执行：${row.name} → ${command}`);
      }
    } finally { db.close(); }
  }
  console.log(`检查通过：${buildInfo.version}，配置 ${path}`);
}
try { run(process.argv.slice(2)); }
catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
