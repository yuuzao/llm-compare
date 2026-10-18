import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertWorkRootSafe, compareFingerprints, fingerprintDir, WorkDirs } from "../src/services/workdir.ts";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "llm-compare-test-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("fingerprintDir / compareFingerprints", () => {
  it("目录未变化时返回 null", () => {
    const d = tempDir();
    writeFileSync(join(d, "a.md"), "x");
    expect(compareFingerprints(fingerprintDir(d), fingerprintDir(d))).toBeNull();
  });

  it("列出新增、删除和修改的文件", () => {
    const d = tempDir();
    writeFileSync(join(d, "keep.md"), "1");
    writeFileSync(join(d, "gone.md"), "1");
    mkdirSync(join(d, "sub"));
    writeFileSync(join(d, "sub", "edit.md"), "1");
    const before = fingerprintDir(d);
    rmSync(join(d, "gone.md"));
    writeFileSync(join(d, "sub", "edit.md"), "2");
    writeFileSync(join(d, "new.md"), "1");
    expect(compareFingerprints(before, fingerprintDir(d))).toBe(`新增 new.md；删除 gone.md；修改 ${join("sub", "edit.md")}`);
  });
});

describe("assertWorkRootSafe", () => {
  it("拒绝位于主目录内的工作根目录", () => {
    const home = tempDir();
    expect(() => assertWorkRootSafe(join(home, "work"), home)).toThrow("主目录");
  });

  it("上级目录存在上下文文件时拒绝启动（大小写不敏感）", () => {
    const parent = tempDir();
    writeFileSync(join(parent, "claude.md"), "rules");
    expect(() => assertWorkRootSafe(join(parent, "work"), "/nonexistent-home")).toThrow("上下文文件");
  });

  it("上级目录是 git 仓库时拒绝启动", () => {
    const parent = tempDir();
    mkdirSync(join(parent, ".git"));
    expect(() => assertWorkRootSafe(join(parent, "work"), "/nonexistent-home")).toThrow("git 仓库");
  });

  it("干净目录可以通过并被创建", () => {
    const parent = tempDir();
    expect(() => assertWorkRootSafe(join(parent, "work"), "/nonexistent-home")).not.toThrow();
  });
});

describe("WorkDirs.writeSnapshot", () => {
  it("拒绝带路径或隐藏文件名", () => {
    const w = new WorkDirs(tempDir());
    expect(() => w.writeSnapshot("m1", { "../x.md": "a" })).toThrow("不合法");
    expect(() => w.writeSnapshot("m2", { ".hidden": "a" })).toThrow("不合法");
  });
});
