import { describe, expect, it } from "vitest";
import { buildSandboxArgv, type SandboxHost } from "../src/acp/sandbox.ts";

const existing = new Set(["/work/a1", "/home/u/.codex/auth.json", "/home/u/.dsh/profiles/acp"]);
const host: SandboxHost = {
  bwrapPath: "/usr/bin/bwrap",
  home: "/home/u",
  user: "u",
  path: "/usr/bin",
  lang: null,
  exists: (p) => existing.has(p),
};

const base = { command: "node", args: ["agent.js"], home_mode: "clean" as const, mounts: [], env: [] };

function pairsAfter(argv: string[], flag: string): string[][] {
  const out: string[][] = [];
  argv.forEach((a, i) => {
    if (a === flag) out.push(argv.slice(i + 1, i + 3));
  });
  return out;
}

describe("buildSandboxArgv", () => {
  it("clean 模式用 tmpfs 覆盖 HOME，并清空环境变量", () => {
    const argv = buildSandboxArgv(host, { config: base, cwd: "/work/a1" });
    expect(argv[0]).toBe("/usr/bin/bwrap");
    expect(argv.join(" ")).toContain("--tmpfs /home/u");
    expect(argv).toContain("--clearenv");
    expect(argv).not.toContain("LANG");
    expect(argv.slice(-6)).toEqual(["/work/a1", "--chdir", "/work/a1", "--", "node", "agent.js"]);
    expect(pairsAfter(argv, "--ro-bind")).toContainEqual(["/work/a1", "/work/a1"]);
  });

  it("overlay 模式把 HOME 叠加为临时可写层", () => {
    const argv = buildSandboxArgv(host, { config: { ...base, home_mode: "overlay" }, cwd: "/work/a1" });
    expect(argv.join(" ")).toContain("--overlay-src /home/u --tmp-overlay /home/u");
    expect(argv.join(" ")).not.toContain("--tmpfs /home/u");
  });

  it("按挂载方式生成 ro / rw / overlay 参数，并支持改写沙箱内路径", () => {
    const argv = buildSandboxArgv(host, {
      config: {
        ...base,
        mounts: [
          { host_path: "/home/u/.codex/auth.json", sandbox_path: null, mode: "rw" },
          { host_path: "/home/u/.dsh/profiles/acp", sandbox_path: "/home/u/profile", mode: "overlay" },
        ],
      },
      cwd: "/work/a1",
    });
    expect(pairsAfter(argv, "--bind")).toContainEqual(["/home/u/.codex/auth.json", "/home/u/.codex/auth.json"]);
    expect(argv.join(" ")).toContain("--overlay-src /home/u/.dsh/profiles/acp --tmp-overlay /home/u/profile");
  });

  it("挂载路径不存在、工作目录不存在、覆盖保留变量时直接报错", () => {
    expect(() =>
      buildSandboxArgv(host, { config: { ...base, mounts: [{ host_path: "/nope", sandbox_path: null, mode: "ro" }] }, cwd: "/work/a1" }),
    ).toThrow("/nope");
    expect(() => buildSandboxArgv(host, { config: base, cwd: "/work/missing" })).toThrow("工作目录不存在");
    expect(() => buildSandboxArgv(host, { config: { ...base, env: [{ name: "HOME", value: "/x" }] }, cwd: "/work/a1" })).toThrow("HOME");
  });
});
