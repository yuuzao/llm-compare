import { existsSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentConfigInput } from "@llm-compare/shared";

const VERIFIED_NOTE =
  "2026-10-16 接入验证（probe/ 目录）：沙箱内向模型提问“指令中是否包含零 Mock 规则”，宿主机运行回答 YES、干净沙箱回答 NO；写入 cwd 失败且目录不变。";

function findNpxPackage(home: string, pkg: string): string {
  const root = join(home, ".npm", "_npx");
  if (!existsSync(root)) throw new Error(`找不到 npx 缓存目录 ${root}，请先运行一次 npx -y ${pkg}`);
  for (const hash of readdirSync(root)) {
    const dir = join(root, hash, "node_modules", pkg);
    if (existsSync(join(dir, "package.json"))) return dir;
  }
  throw new Error(`npx 缓存中没有 ${pkg}，请先运行一次 npx -y ${pkg}`);
}

function npxRoot(pkgDir: string, pkg: string): string {
  let d = pkgDir;
  for (const _ of pkg.split("/")) d = dirname(d);
  return dirname(d);
}

type Builder = { key: string; build: (home: string) => AgentConfigInput };

// Pi 的 Cursor 扩展需要实际 CLI 与登录凭据，不能只挂载扩展自身。
// 缺少 CLI 时仍可导入不使用 Cursor 扩展的 Pi 配置。
function cursorRuntime(home: string): Pick<AgentConfigInput, "mounts" | "env"> {
  const link = join(home, ".local/bin/agent");
  if (!existsSync(link)) return { mounts: [], env: [] };
  const command = realpathSync(link);
  const auth = join(home, ".config/cursor/auth.json");
  return {
    mounts: [
      { host_path: dirname(command), sandbox_path: null, mode: "ro" },
      ...(existsSync(auth) ? [{ host_path: auth, sandbox_path: null, mode: "rw" as const }] : []),
    ],
    env: [{ name: "CURSOR_AGENT_PATH", value: command }],
  };
}

const BUILDERS: Builder[] = [
  {
    key: "pi",
    build: (home) => {
      const dir = findNpxPackage(home, "pi-acp");
      const cursor = cursorRuntime(home);
      return {
        name: "Pi 干净",
        command: "node",
        args: [join(dir, "dist", "index.js")],
        home_mode: "clean",
        mounts: [
          { host_path: npxRoot(dir, "pi-acp"), sandbox_path: null, mode: "ro" },
          { host_path: join(home, ".pi/agent/auth.json"), sandbox_path: null, mode: "rw" },
          { host_path: join(home, ".pi/agent/models.json"), sandbox_path: null, mode: "ro" },
          { host_path: join(home, ".pi/agent/models-store.json"), sandbox_path: null, mode: "rw" },
          { host_path: join(home, ".pi/agent/npm"), sandbox_path: null, mode: "ro" },
          { host_path: join(home, ".config/llm-compare/pi-sandbox-settings.json"), sandbox_path: join(home, ".pi/agent/settings.json"), mode: "ro" },
          ...cursor.mounts,
        ],
        env: [
          { name: "npm_config_offline", value: "true" },
          { name: "npm_config_cache", value: "/tmp/npm-empty-cache" },
          ...cursor.env,
        ],
        model_config_id: "model",
        thought_mode: "option",
        thought_config_id: "thought_level",
        readonly_config_id: null,
        readonly_value: null,
        clean_status: "verified",
        clean_verification_note: `${VERIFIED_NOTE} 需要自行准备 ~/.config/llm-compare/pi-sandbox-settings.json，内容至少包含 "quietStartup": true 和原 settings.json 的 packages。`,
      };
    },
  },
  {
    key: "codex",
    build: (home) => {
      const dir = findNpxPackage(home, "@agentclientprotocol/codex-acp");
      return {
        name: "Codex 干净",
        command: "node",
        args: [join(dir, "dist", "index.js")],
        home_mode: "clean",
        mounts: [
          { host_path: npxRoot(dir, "@agentclientprotocol/codex-acp"), sandbox_path: null, mode: "ro" },
          { host_path: join(home, ".codex/auth.json"), sandbox_path: null, mode: "rw" },
          { host_path: join(home, ".codex/config.toml"), sandbox_path: null, mode: "ro" },
        ],
        env: [],
        model_config_id: "model",
        thought_mode: "option",
        thought_config_id: "reasoning_effort",
        readonly_config_id: "mode",
        readonly_value: "read-only",
        clean_status: "verified",
        clean_verification_note: `${VERIFIED_NOTE} 以沙箱内 ~/.codex/AGENTS.md 不可见为依据。`,
      };
    },
  },
  {
    key: "cursor",
    build: (home) => {
      const link = join(home, ".local/bin/agent");
      if (!existsSync(link)) throw new Error(`找不到 Cursor Agent 命令 ${link}`);
      return {
        name: "Cursor Agent",
        command: realpathSync(link),
        args: ["acp"],
        home_mode: "overlay",
        mounts: [{ host_path: join(home, ".config/cursor/auth.json"), sandbox_path: null, mode: "rw" }],
        env: [],
        model_config_id: "model",
        thought_mode: "option",
        thought_config_id: "thought_level",
        readonly_config_id: "mode",
        readonly_value: "ask",
        clean_status: "unverified",
        clean_verification_note: null,
      };
    },
  },
  {
    key: "dsh",
    build: (home) => {
      const bin = join(home, ".local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js");
      if (!existsSync(bin)) throw new Error(`找不到 DeepSeek Harness 入口 ${bin}`);
      return {
        name: "DeepSeek Harness 干净",
        command: "node",
        args: [bin, "--profile", "acp"],
        home_mode: "clean",
        mounts: [
          { host_path: join(home, ".local/lib/node_modules"), sandbox_path: null, mode: "ro" },
          { host_path: join(home, ".dsh/.credentials.yaml"), sandbox_path: null, mode: "rw" },
          { host_path: join(home, ".dsh/profiles/acp"), sandbox_path: null, mode: "overlay" },
        ],
        env: [],
        model_config_id: "model",
        thought_mode: "option",
        thought_config_id: "reasoning_effort",
        readonly_config_id: null,
        readonly_value: null,
        clean_status: "verified",
        clean_verification_note: VERIFIED_NOTE,
      };
    },
  },
];

function globalConfig(home: string, clean: AgentConfigInput): AgentConfigInput {
  const credentials = new Set([
    join(home, ".pi/agent/auth.json"),
    join(home, ".codex/auth.json"),
    join(home, ".config/cursor/auth.json"),
    join(home, ".dsh/.credentials.yaml"),
  ]);
  return {
    ...clean,
    name: clean.name.replace(/ 干净$/, " 全局"),
    home_mode: "overlay",
    // 主目录覆盖层直接读取本机配置；不再挂载干净模式的精简设置或隔离目录。
    mounts: clean.mounts.filter((m) => credentials.has(m.host_path)),
    env: clean.env.filter((e) => !["npm_config_offline", "npm_config_cache"].includes(e.name)),
    clean_status: "unverified",
    clean_verification_note: null,
  };
}

export function buildVerifiedConfigs(home: string): { configs: AgentConfigInput[]; errors: { key: string; message: string }[] } {
  const configs: AgentConfigInput[] = [];
  const errors: { key: string; message: string }[] = [];
  for (const b of BUILDERS) {
    try {
      const config = b.build(home);
      configs.push(config);
      if (config.home_mode === "clean") configs.push(globalConfig(home, config));
    } catch (err) {
      errors.push({ key: b.key, message: (err as Error).message });
    }
  }
  return { configs, errors };
}
