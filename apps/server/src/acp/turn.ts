import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { performance } from "node:perf_hooks";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { ConfigOptionView } from "@llm-compare/shared";
import type { Logger } from "../logger.ts";
import { findOption, toOptionView } from "./options.ts";
import { SessionPrelude } from "./session-prelude.ts";

export type SettingKind = "model" | "thought" | "model_parameter" | "readonly";
export type Setting = { kind: SettingKind; configId: string; value: string };

export type TurnEvent =
  | { type: "output_chunk"; text: string }
  | { type: "thought_chunk"; text: string }
  | { type: "tool_call" | "tool_call_update" | "plan"; raw: unknown }
  | { type: "permission"; kind: string | null; title: string | null; decision: "allow" | "reject" | "no_matching_option"; option_kind: string | null }
  | { type: "usage_update"; used: number; size: number; cost: { amount: number; currency: string } | null }
  | { type: "config_option_update"; options: ConfigOptionView[]; changed_settings: SettingKind[] };

export type Stamp = { iso: string; mono: number };
const stamp = (): Stamp => ({ iso: new Date().toISOString(), mono: performance.now() });

export type TurnResult = {
  outcome: "succeeded" | "failed" | "cancelled";
  error: string | null;
  protocolVersion: number | null;
  agentInfo: { name: string; version: string } | null;
  agentCapabilities: acp.AgentCapabilities | null;
  authMethods: unknown[];
  sessionId: string | null;
  initialOptions: ConfigOptionView[];
  optionsAfterSettings: ConfigOptionView[];
  readbacks: Partial<Record<SettingKind, string>>;
  stopReason: string | null;
  promptUsage: acp.Usage | null;
  lastUsageUpdate: acp.UsageUpdate | null;
  configChanged: boolean;
  outputText: string;
  t: { spawn: Stamp | null; ready: Stamp | null; prompt: Stamp | null; firstChunk: Stamp | null; end: Stamp | null };
};

export type TurnOptions = {
  argv: string[];
  sessionCwd: string;
  settings: Setting[];
  parameterizedModelPicker?: boolean;
  promptText: string | null;
  promptAttachments?: acp.ContentBlock[];
  inspectAgent?: (agent: { conn: acp.ClientSideConnection; initialization: acp.InitializeResponse }) => Promise<void>;
  afterSettings?: (session: { conn: acp.ClientSideConnection; sessionId: string; options: ConfigOptionView[]; authMethods: unknown[] }) => Promise<void>;
  startupTimeoutMs: number;
  promptTimeoutMs: number;
  cancelConfirmMs: number;
  maxOutputChars: number;
  stderrPath: string;
  onEvent: (e: TurnEvent) => void;
  log: Logger;
};

const REJECT_KINDS = new Set(["edit", "delete", "move", "execute", "switch_mode", "other"]);

class TurnFailure extends Error {}

export class AcpTurn {
  private child: ChildProcess | null = null;
  private conn: acp.ClientSideConnection | null = null;
  private stderr: WriteStream | null = null;
  private outputChars = 0;
  private readonly prelude = new SessionPrelude();
  private cancelRequested = false;
  private cancelTimer: NodeJS.Timeout | null = null;
  private wakeCancel: (() => void) | null = null;
  private exitInfo: { code: number | null; signal: string | null } | null = null;
  private readonly result: TurnResult = {
    outcome: "failed",
    error: null,
    protocolVersion: null,
    agentInfo: null,
    agentCapabilities: null,
    authMethods: [],
    sessionId: null,
    initialOptions: [],
    optionsAfterSettings: [],
    readbacks: {},
    stopReason: null,
    promptUsage: null,
    lastUsageUpdate: null,
    configChanged: false,
    outputText: "",
    t: { spawn: null, ready: null, prompt: null, firstChunk: null, end: null },
  };

  private readonly opts: TurnOptions;

  constructor(opts: TurnOptions) {
    this.opts = opts;
  }

  cancel(): void {
    if (this.cancelRequested) return;
    this.cancelRequested = true;
    this.opts.log.info({ phase: this.result.t.prompt ? "prompt" : "startup" }, "收到取消请求");
    this.wakeCancel?.();
  }

  async run(): Promise<TurnResult> {
    try {
      await this.execute();
    } catch (err) {
      if (this.result.outcome !== "cancelled") {
        this.result.outcome = "failed";
        this.result.error = this.describeError(err);
        this.opts.log.warn({ err: this.result.error, exit: this.exitInfo }, "ACP 会话失败");
      }
    } finally {
      this.result.t.end ??= stamp();
      if (this.cancelTimer) clearTimeout(this.cancelTimer);
      await this.shutdown();
    }
    return this.result;
  }

  private describeError(err: unknown): string {
    const base = err instanceof Error ? err.message : JSON.stringify(err);
    const data = (err as { data?: unknown })?.data;
    const exit = this.exitInfo ? `；适配器进程已退出（退出码 ${this.exitInfo.code ?? "无"}，信号 ${this.exitInfo.signal ?? "无"}）` : "";
    return `${base}${data ? `：${JSON.stringify(data)}` : ""}${exit}`;
  }

  private async execute(): Promise<void> {
    const { opts, result } = this;
    this.launch();
    const startup = this.withTimeout(this.startup(), opts.startupTimeoutMs, `启动与配置设置超过 ${opts.startupTimeoutMs} 毫秒`);
    await this.raceCancel(startup, "startup");
    result.t.ready = stamp();
    if (opts.promptText === null) {
      result.outcome = "succeeded";
      return;
    }
    await this.prompt(opts.promptText);
  }

  private launch(): void {
    const [cmd, ...args] = this.opts.argv;
    if (!cmd) throw new Error("启动参数为空");
    this.result.t.spawn = stamp();
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], cwd: "/" });
    this.child = child;
    this.stderr = createWriteStream(this.opts.stderrPath, { flags: "a" });
    child.stderr!.pipe(this.stderr);
    child.on("exit", (code, signal) => {
      this.exitInfo = { code, signal };
      this.opts.log.debug({ code, signal }, "适配器进程退出");
    });
    child.on("error", (err) => this.opts.log.error({ err: err.message }, "适配器进程启动错误"));
    const stream = acp.ndJsonStream(Writable.toWeb(child.stdin!), Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>);
    this.conn = new acp.ClientSideConnection(() => this.client(), stream);
  }

  private client(): acp.Client {
    return {
      requestPermission: async (params) => this.onPermission(params),
      sessionUpdate: async (params) => this.onUpdate(params),
    };
  }

  private async startup(): Promise<void> {
    const conn = this.conn!;
    const init = await conn.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, ...(this.opts.parameterizedModelPicker ? { _meta: { parameterizedModelPicker: true } } : {}) },
      clientInfo: { name: "llm-compare", version: "1.0.0" },
    });
    if (init.protocolVersion !== acp.PROTOCOL_VERSION) {
      throw new TurnFailure(`Agent 协商的协议版本 ${init.protocolVersion} 不受支持（需要 ${acp.PROTOCOL_VERSION}）`);
    }
    this.result.protocolVersion = init.protocolVersion;
    this.result.agentInfo = init.agentInfo ? { name: init.agentInfo.name, version: init.agentInfo.version } : null;
    this.result.agentCapabilities = init.agentCapabilities ?? null;
    this.result.authMethods = init.authMethods ?? [];

    if (this.opts.inspectAgent) {
      if (this.opts.promptText !== null || this.opts.settings.length) throw new TurnFailure("读取 Agent 目录时不能发送提示词或修改会话设置");
      await this.opts.inspectAgent({ conn, initialization: init });
      return;
    }

    const session = await conn.newSession({ cwd: this.opts.sessionCwd, mcpServers: [] });
    this.prelude.announce(session._meta);
    this.result.sessionId = session.sessionId;
    let options = (session.configOptions ?? []).map(toOptionView);
    this.result.initialOptions = options;

    for (const s of this.opts.settings) {
      const opt = findOption(options, s.configId);
      if (!opt) throw new TurnFailure(`Agent 未提供配置项 ${s.configId}（用于设置${KIND_LABEL[s.kind]}）`);
      if (opt.type !== "select") throw new TurnFailure(`配置项 ${s.configId} 的类型是 ${opt.type}，只支持选择类配置项`);
      if (!opt.values.some((v) => v.value === s.value)) {
        throw new TurnFailure(`${KIND_LABEL[s.kind]}取值 ${s.value} 不在 Agent 当前列出的选项中`);
      }
      const resp = await conn.setSessionConfigOption({ sessionId: session.sessionId, configId: s.configId, value: s.value });
      options = resp.configOptions.map(toOptionView);
      const readback = findOption(options, s.configId)?.current_value ?? null;
      if (readback === null) throw new TurnFailure(`设置${KIND_LABEL[s.kind]}后无法回读配置项 ${s.configId}`);
      this.result.readbacks[s.kind] = readback;
      if (readback !== s.value) throw new TurnFailure(`${KIND_LABEL[s.kind]}回读不一致：请求 ${s.value}，Agent 报告 ${readback}`);
    }
    // 后续参数可能影响先前设置；发送提示词前再次核对全部取值。
    for (const s of this.opts.settings) {
      if (findOption(options, s.configId)?.current_value !== s.value) throw new TurnFailure(`${KIND_LABEL[s.kind]}在配置完成后发生变化，请重新选择`);
    }
    this.result.optionsAfterSettings = options;
    if (this.opts.afterSettings) await this.opts.afterSettings({ conn, sessionId: session.sessionId, options, authMethods: this.result.authMethods });
  }

  private async prompt(text: string): Promise<void> {
    const { result, opts } = this;
    const conn = this.conn!;
    const sessionId = result.sessionId!;
    result.t.prompt = stamp();
    const attachments = this.opts.promptAttachments ?? [];
    for (const part of attachments) {
      if (part.type === "image" && !this.result.agentCapabilities?.promptCapabilities?.image) throw new TurnFailure("Agent 当前会话不支持图片输入");
      if (part.type === "resource" && !this.result.agentCapabilities?.promptCapabilities?.embeddedContext) throw new TurnFailure("Agent 当前会话不支持附件输入");
    }
    const promptPromise = conn.prompt({ sessionId, prompt: [{ type: "text", text }, ...attachments] });
    const timeout = setTimeout(() => {
      opts.log.warn({ timeoutMs: opts.promptTimeoutMs }, "生成超时，发送取消");
      result.error = `生成超过 ${opts.promptTimeoutMs} 毫秒`;
      this.cancel();
    }, opts.promptTimeoutMs);
    this.wakeCancel = () => this.sendCancel(sessionId);
    if (this.cancelRequested) this.sendCancel(sessionId);
    try {
      const resp = await Promise.race([promptPromise, this.cancelDeadline()]);
      result.t.end = stamp();
      result.stopReason = resp.stopReason;
      result.promptUsage = resp.usage ?? null;
      this.classifyStop(resp.stopReason);
    } finally {
      clearTimeout(timeout);
    }
  }

  private classifyStop(stopReason: string): void {
    const { result } = this;
    if (stopReason === "end_turn" && result.error === null) result.outcome = "succeeded";
    else if (stopReason === "cancelled") {
      result.outcome = result.error === null ? "cancelled" : "failed";
    } else {
      result.outcome = "failed";
      result.error ??= `Agent 结束原因：${stopReason}`;
    }
  }

  private sendCancel(sessionId: string): void {
    this.conn!.cancel({ sessionId }).catch((err: unknown) => this.opts.log.warn({ err: String(err) }, "发送 session/cancel 失败"));
  }

  private cancelDeadline(): Promise<never> {
    return new Promise((_, reject) => {
      const arm = () => {
        this.cancelTimer = setTimeout(() => {
          reject(new TurnFailure(`取消请求在 ${this.opts.cancelConfirmMs} 毫秒内未得到 Agent 确认，已终止适配器进程`));
        }, this.opts.cancelConfirmMs);
      };
      if (this.cancelRequested) arm();
      else {
        const prev = this.wakeCancel;
        this.wakeCancel = () => {
          prev?.();
          arm();
        };
      }
    });
  }

  private async raceCancel<T>(p: Promise<T>, phase: string): Promise<T> {
    const cancelled = new Promise<never>((_, reject) => {
      const fire = () => {
        this.result.outcome = "cancelled";
        reject(new TurnFailure(`在${phase === "startup" ? "启动阶段" : phase}被取消`));
      };
      if (this.cancelRequested) fire();
      else this.wakeCancel = fire;
    });
    try {
      return await Promise.race([p, cancelled]);
    } finally {
      this.wakeCancel = null;
    }
  }

  private withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: NodeJS.Timeout;
    const t = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new TurnFailure(message)), ms);
    });
    return Promise.race([p, t]).finally(() => clearTimeout(timer));
  }

  private async onPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    const kind = params.toolCall.kind ?? null;
    const reject = kind === null || REJECT_KINDS.has(kind);
    const wanted = reject ? ["reject_once", "reject_always"] : ["allow_once", "allow_always"];
    const option = params.options.find((o) => o.kind === wanted[0]) ?? params.options.find((o) => o.kind === wanted[1]);
    this.opts.onEvent({
      type: "permission",
      kind,
      title: params.toolCall.title ?? null,
      decision: option ? (reject ? "reject" : "allow") : "no_matching_option",
      option_kind: option?.kind ?? null,
    });
    if (!option) {
      this.result.error = `Agent 请求权限（${kind ?? "未知类型"}：${params.toolCall.title ?? ""}）但没有可用的${reject ? "拒绝" : "允许"}选项`;
      this.cancel();
      return { outcome: { outcome: "cancelled" } };
    }
    return { outcome: { outcome: "selected", optionId: option.optionId } };
  }

  private async onUpdate(params: acp.SessionNotification): Promise<void> {
    const u = params.update;
    switch (u.sessionUpdate) {
      case "agent_message_chunk": {
        const text = u.content.type === "text" ? u.content.text : `[${u.content.type}]`;
        if (this.prelude.consume(text)) {
          this.opts.log.debug({ chars: text.length }, "收到 Agent 在会话元数据中声明的启动横幅，不计入模型回复");
          return;
        }
        if (this.result.t.prompt === null) {
          this.opts.log.warn({ text: text.slice(0, 200) }, "提示词发送前收到消息片段，已忽略");
          return;
        }
        this.result.t.firstChunk ??= stamp();
        this.result.outputText += text;
        this.outputChars += [...text].length;
        this.opts.onEvent({ type: "output_chunk", text });
        if (this.outputChars > this.opts.maxOutputChars) {
          this.result.error = `输出超过上限 ${this.opts.maxOutputChars} 字符`;
          this.cancel();
        }
        return;
      }
      case "agent_thought_chunk":
        this.opts.onEvent({ type: "thought_chunk", text: u.content.type === "text" ? u.content.text : `[${u.content.type}]` });
        return;
      case "tool_call":
      case "tool_call_update":
      case "plan":
        this.opts.onEvent({ type: u.sessionUpdate, raw: u });
        return;
      case "usage_update":
        this.result.lastUsageUpdate = u;
        this.opts.onEvent({ type: "usage_update", used: u.used, size: u.size, cost: u.cost ? { amount: u.cost.amount, currency: u.cost.currency } : null });
        return;
      case "config_option_update": {
        const options = u.configOptions.map(toOptionView);
        const changed = this.opts.settings
          .filter((s) => this.result.t.ready !== null && findOption(options, s.configId)?.current_value !== s.value)
          .map((s) => s.kind);
        if (changed.length > 0) this.result.configChanged = true;
        this.opts.onEvent({ type: "config_option_update", options, changed_settings: changed });
        return;
      }
      default:
        this.opts.log.debug({ sessionUpdate: u.sessionUpdate }, "忽略与输出无关的会话通知");
    }
  }

  private async shutdown(): Promise<void> {
    const child = this.child;
    if (!child) return;
    if (this.exitInfo === null) {
      child.stdin?.end();
      child.kill("SIGTERM");
      const exited = await Promise.race([
        new Promise<boolean>((r) => child.once("exit", () => r(true))),
        new Promise<boolean>((r) => setTimeout(() => r(false), 5000)),
      ]);
      if (!exited) {
        this.opts.log.warn("适配器进程 5 秒内未退出，发送 SIGKILL");
        child.kill("SIGKILL");
      }
    }
    await new Promise<void>((r) => (this.stderr ? this.stderr.end(r) : r()));
  }
}

const KIND_LABEL: Record<SettingKind, string> = { model: "模型", thought: "思考强度", model_parameter: "模型参数", readonly: "只读模式" };
