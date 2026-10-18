// pi-acp 会在 session/new 元数据中声明横幅，并异步发送同一段 agent_message_chunk。
// 只识别该声明的首个完整片段，不按版本号、提示文本等内容特征过滤模型输出。
export class SessionPrelude {
  private pending: string | null = null;

  announce(meta: Record<string, unknown> | null | undefined): void {
    const pi = meta?.piAcp;
    const text = pi && typeof pi === "object" && "startupInfo" in pi ? pi.startupInfo : null;
    this.pending = typeof text === "string" && text.length > 0 ? text : null;
  }

  consume(text: string): boolean {
    const pending = this.pending;
    this.pending = null;
    return pending !== null && text === pending;
  }
}
