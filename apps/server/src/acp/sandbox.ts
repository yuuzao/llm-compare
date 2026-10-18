import type { AgentConfigInput } from "@llm-compare/shared";

export type SandboxHost = {
  bwrapPath: string;
  home: string;
  user: string;
  path: string;
  lang: string | null;
  exists: (p: string) => boolean;
};

export type SandboxRequest = {
  config: Pick<AgentConfigInput, "command" | "args" | "home_mode" | "mounts" | "env">;
  cwd: string;
};

const RESERVED_ENV = new Set(["HOME", "PATH", "USER", "LANG"]);

export function buildSandboxArgv(host: SandboxHost, req: SandboxRequest): string[] {
  const { config, cwd } = req;
  if (!host.exists(cwd)) throw new Error(`沙箱工作目录不存在: ${cwd}`);
  const args = [
    host.bwrapPath,
    "--die-with-parent",
    "--unshare-pid",
    "--unshare-ipc",
    "--ro-bind", "/usr", "/usr",
    "--symlink", "usr/bin", "/bin",
    "--symlink", "usr/lib", "/lib",
    "--symlink", "usr/lib", "/lib64",
    "--symlink", "usr/bin", "/sbin",
    "--ro-bind", "/etc", "/etc",
    "--ro-bind-try", "/opt", "/opt",
    "--ro-bind-try", "/run/systemd/resolve", "/run/systemd/resolve",
    "--proc", "/proc",
    "--dev", "/dev",
    "--tmpfs", "/tmp",
  ];
  if (config.home_mode === "overlay") args.push("--overlay-src", host.home, "--tmp-overlay", host.home);
  else args.push("--tmpfs", host.home);

  args.push("--clearenv", "--setenv", "HOME", host.home, "--setenv", "PATH", host.path, "--setenv", "USER", host.user);
  if (host.lang !== null) args.push("--setenv", "LANG", host.lang);
  for (const e of config.env) {
    if (RESERVED_ENV.has(e.name)) throw new Error(`环境变量 ${e.name} 由沙箱统一设置，不能覆盖`);
    args.push("--setenv", e.name, e.value);
  }

  for (const m of config.mounts) {
    if (!host.exists(m.host_path)) throw new Error(`沙箱挂载的宿主机路径不存在: ${m.host_path}`);
    const dest = m.sandbox_path ?? m.host_path;
    if (m.mode === "overlay") args.push("--overlay-src", m.host_path, "--tmp-overlay", dest);
    else args.push(m.mode === "ro" ? "--ro-bind" : "--bind", m.host_path, dest);
  }

  args.push("--ro-bind", cwd, cwd, "--chdir", cwd, "--", config.command, ...config.args);
  return args;
}
