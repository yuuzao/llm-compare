import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const CONTEXT_FILES = ["AGENTS.md", "AGENTS.override.md", "CLAUDE.md"];

export function assertWorkRootSafe(workRoot: string, home: string): void {
  const root = resolve(workRoot);
  const homeDir = resolve(home);
  if (root === homeDir || root.startsWith(homeDir + sep)) {
    throw new Error(`work_root ${root} 位于用户主目录 ${homeDir} 内，部分 Agent 会向上查找上下文文件，必须放在主目录之外`);
  }
  mkdirSync(root, { recursive: true });
  let current = root;
  for (;;) {
    for (const entry of readdirSync(current)) {
      if (CONTEXT_FILES.some((f) => f.toLowerCase() === entry.toLowerCase())) {
        throw new Error(`work_root 的上级目录存在上下文文件 ${join(current, entry)}，拒绝启动`);
      }
      if (entry === ".git") throw new Error(`work_root 位于 git 仓库 ${current} 内，拒绝启动`);
    }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

export class WorkDirs {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  attemptDir(attemptId: string): string {
    const dir = join(this.root, "attempts", attemptId);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  probeDir(label: string): string {
    const dir = join(this.root, "probes", `${label}-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  writeSnapshot(messageId: string, files: Record<string, string>): string {
    const dir = join(this.root, "analysis", messageId);
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      if (name.includes("/") || name.startsWith(".")) throw new Error(`快照文件名不合法: ${name}`);
      writeFileSync(join(dir, name), content);
    }
    return dir;
  }
}

export function fingerprintDir(dir: string): Record<string, string> {
  if (!existsSync(dir)) throw new Error(`目录不存在: ${dir}`);
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else out[relative(dir, p)] = createHash("sha256").update(readFileSync(p)).digest("hex");
    }
  };
  walk(dir);
  return out;
}

export function compareFingerprints(before: Record<string, string>, after: Record<string, string>): string | null {
  const added = Object.keys(after).filter((k) => !(k in before));
  const removed = Object.keys(before).filter((k) => !(k in after));
  const modified = Object.keys(before).filter((k) => k in after && before[k] !== after[k]);
  if (added.length + removed.length + modified.length === 0) return null;
  const parts = [];
  if (added.length) parts.push(`新增 ${added.join("、")}`);
  if (removed.length) parts.push(`删除 ${removed.join("、")}`);
  if (modified.length) parts.push(`修改 ${modified.join("、")}`);
  return parts.join("；");
}
