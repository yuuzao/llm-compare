import { describe, expect, it } from "vitest";
import { SessionPrelude } from "../src/acp/session-prelude.ts";

describe("session startup messages", () => {
  it("只消费元数据声明的首个完整横幅，后续同文模型输出保留", () => {
    const prelude = new SessionPrelude();
    prelude.announce({ piAcp: { startupInfo: "pi version\nskills\n" } });
    expect(prelude.consume("pi version\nskills\n")).toBe(true);
    expect(prelude.consume("pi version\nskills\n")).toBe(false);
    expect(prelude.consume("PROBE_OK")).toBe(false);
  });

  it("没有声明时，不按看似横幅的内容过滤消息", () => {
    const prelude = new SessionPrelude();
    prelude.announce(undefined);
    expect(prelude.consume("pi version\nNew version available")).toBe(false);
  });

  it("横幅已在 session/new 响应前发送时，保留首个正常回复并清除待识别状态", () => {
    const prelude = new SessionPrelude();
    expect(prelude.consume("startup")).toBe(false);
    prelude.announce({ piAcp: { startupInfo: "startup" } });
    expect(prelude.consume("PROBE_OK")).toBe(false);
    expect(prelude.consume("startup")).toBe(false);
  });

  it("不截断、改写或去除混在正文中的相似内容", () => {
    const prelude = new SessionPrelude();
    prelude.announce({ piAcp: { startupInfo: "startup\n" } });
    expect(prelude.consume("startup\nPROBE_OK")).toBe(false);
    prelude.announce({ piAcp: { startupInfo: null } });
    expect(prelude.consume("PROBE_OK")).toBe(false);
  });
});
