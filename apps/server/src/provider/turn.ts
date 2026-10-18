import type { Logger } from "../logger.ts";
import OpenAI from "openai";
import type { ChatCompletionContentPart, ChatCompletionCreateParamsStreaming } from "openai/resources/chat/completions";
import type { ResponseInputContent, ResponseCreateParamsStreaming } from "openai/resources/responses/responses";
import type { AttachmentView, ProviderTargetSnapshot } from "@llm-compare/shared";
import type { Stamp, TurnEvent, TurnResult } from "../acp/turn.ts";
import type { AttachmentService } from "../services/attachments.ts";

const stamp = (): Stamp => ({ iso: new Date().toISOString(), mono: performance.now() });
export class ProviderTurn {
  private readonly controller = new AbortController();
  private cancelled = false;
  private readonly opts: { snapshot: ProviderTargetSnapshot; apiKey: string; text: string; files: AttachmentView[]; attachments: AttachmentService; timeoutMs: number; maxChars: number; onEvent: (e: TurnEvent) => void; log: Logger };
  constructor(opts: ProviderTurn["opts"]) { this.opts = opts; }
  cancel(): void { this.cancelled = true; this.controller.abort(); }
  async run(): Promise<TurnResult> {
    const { snapshot: s, apiKey, text, files, attachments, onEvent } = this.opts;
    const r: TurnResult = { outcome: "failed", error: null, protocolVersion: null, agentInfo: null, agentCapabilities: null, authMethods: [], sessionId: null, initialOptions: [], optionsAfterSettings: [], readbacks: {}, stopReason: null, promptUsage: null, lastUsageUpdate: null, configChanged: false, outputText: "", t: { spawn: stamp(), ready: null, prompt: null, firstChunk: null, end: null } };
    const timer = setTimeout(() => this.controller.abort(new Error("API 请求超时")), this.opts.timeoutMs);
    const emit = (type: "output_chunk" | "thought_chunk", value: string) => {
      if (type === "output_chunk") {
        if (r.outputText.length + value.length > this.opts.maxChars) throw new Error("API 输出超过长度限制");
        r.t.firstChunk ??= stamp();
        r.outputText += value;
      }
      onEvent({ type, text: value });
    };
    try {
      const client = new OpenAI({ baseURL: s.base_url.replace(/\/$/, ""), apiKey, maxRetries: 0, timeout: this.opts.timeoutMs });
      const chatParts: ChatCompletionContentPart[] = [{ type: "text", text }];
      const responseParts: ResponseInputContent[] = [{ type: "input_text", text }];
      for (const f of files) {
        const bytes = attachments.data(f);
        const data = `data:${f.mime_type};base64,${bytes.toString("base64")}`;
        if (f.kind === "text") {
          const value = `附件：${f.name}\n${bytes.toString("utf8")}`;
          chatParts.push({ type: "text", text: value });
          responseParts.push({ type: "input_text", text: value });
        } else if (f.kind === "image") {
          chatParts.push({ type: "image_url", image_url: { url: data } });
          responseParts.push({ type: "input_image", image_url: data, detail: "auto" });
        } else {
          chatParts.push({ type: "file", file: { filename: f.name, file_data: data } });
          responseParts.push({ type: "input_file", filename: f.name, file_data: data });
        }
      }
      r.t.ready = stamp();
      r.t.prompt = stamp();
      let completed = false;
      if (s.protocol === "chat_completions") {
        const params: ChatCompletionCreateParamsStreaming = { model: s.model_value, messages: [{ role: "user", content: chatParts }], stream: true, store: false, stream_options: { include_usage: true } };
        if (s.thought_native_value) params.reasoning_effort = s.thought_native_value as ChatCompletionCreateParamsStreaming["reasoning_effort"];
        const stream = await client.chat.completions.create(params, { signal: this.controller.signal });
        for await (const chunk of stream) {
          if (chunk.model) r.readbacks.model = chunk.model;
          for (const choice of chunk.choices) {
            if (choice.index !== 0) throw new Error("API 返回了多个候选结果");
            if (choice.delta.tool_calls?.length) throw new Error("单轮 API 请求不执行工具调用");
            if (choice.delta.content) emit("output_chunk", choice.delta.content);
            if (choice.delta.refusal) emit("output_chunk", choice.delta.refusal);
            if (choice.finish_reason) {
              r.stopReason = choice.finish_reason;
              if (choice.finish_reason !== "stop") throw new Error(`API 输出未完整结束：${choice.finish_reason}`);
              completed = true;
            }
          }
          if (chunk.usage) r.promptUsage = { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens, totalTokens: chunk.usage.total_tokens, ...(chunk.usage.completion_tokens_details?.reasoning_tokens != null ? { thoughtTokens: chunk.usage.completion_tokens_details.reasoning_tokens } : {}), ...(chunk.usage.prompt_tokens_details?.cached_tokens != null ? { cachedReadTokens: chunk.usage.prompt_tokens_details.cached_tokens } : {}) };
        }
      } else {
        const params: ResponseCreateParamsStreaming = { model: s.model_value, input: [{ role: "user", content: responseParts }], stream: true, store: false };
        if (s.thought_native_value) params.reasoning = { effort: s.thought_native_value as NonNullable<ResponseCreateParamsStreaming["reasoning"]>["effort"] };
        const stream = await client.responses.create(params, { signal: this.controller.signal });
        for await (const event of stream) {
          if (event.type === "response.output_text.delta" || event.type === "response.refusal.delta") emit("output_chunk", event.delta);
          else if (event.type === "response.reasoning_summary_text.delta") emit("thought_chunk", event.delta);
          else if (event.type === "error") throw new Error(event.message);
          else if (event.type === "response.failed" || event.type === "response.incomplete") {
            r.stopReason = event.response.status ?? event.type;
            throw new Error(event.response.error?.message ?? `API 输出未完整结束：${event.response.incomplete_details?.reason ?? r.stopReason}`);
          } else if (event.type === "response.completed") {
            if (event.response.output.some((item) => item.type !== "message" && item.type !== "reasoning")) throw new Error("单轮 API 请求不执行工具调用或非文本输出");
            completed = true;
            r.stopReason = "completed";
            r.readbacks.model = event.response.model;
            const u = event.response.usage;
            if (u) r.promptUsage = { inputTokens: u.input_tokens, outputTokens: u.output_tokens, totalTokens: u.total_tokens, ...(u.output_tokens_details?.reasoning_tokens != null ? { thoughtTokens: u.output_tokens_details.reasoning_tokens } : {}), ...(u.input_tokens_details?.cached_tokens != null ? { cachedReadTokens: u.input_tokens_details.cached_tokens } : {}) };
          }
        }
      }
      if (!completed) throw new Error("API 数据流意外结束，未收到完成事件");
      if (!r.outputText.length) throw new Error("API 未返回文本结果");
      r.outcome = "succeeded";
    } catch (error) {
      r.outcome = this.cancelled ? "cancelled" : "failed";
      if (this.cancelled) r.stopReason = "cancelled";
      else {
        const detail = (error instanceof Error ? error.message : String(error)).replaceAll(apiKey, "[已隐藏]").slice(0, 2000);
        this.opts.log.warn({ detail, status: error instanceof OpenAI.APIError ? error.status : undefined }, "Provider 请求失败");
        if (this.controller.signal.aborted) r.error = "API 请求超时，已保留收到的输出";
        else if (error instanceof OpenAI.APIConnectionError) r.error = "无法连接 API 服务，请检查基础地址、网络和服务状态";
        else if (error instanceof OpenAI.APIError) {
          const reason = error.status === 401 || error.status === 403 ? "认证失败或无访问权限，请检查 API Key" : error.status === 429 ? "请求达到服务限额，请检查额度或稍后手动重试" : "服务拒绝请求，请检查协议、模型、参数和附件能力";
          r.error = `API 请求失败（HTTP ${error.status ?? "未知"}）：${reason}；详细原因见本机服务日志`;
        } else r.error = /[\u4e00-\u9fff]/.test(detail) ? detail : "API 返回了无法处理的数据，详细原因见本机服务日志";
      }
    } finally { clearTimeout(timer); this.controller.abort(); r.t.end = stamp(); }
    return r;
  }
}
