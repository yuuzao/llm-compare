# llm-compare

本地运行的模型与 Agent 对比工作台。同一份素材、附件和提示词同时交给多个本机 ACP Agent 或自定义 API Provider，并排比较输出、耗时与实际上报的用量。

## 特性

- **自由对比**：每个对比对象独立选择 Agent 或 API Provider、模型与思考强度，一轮最多 4 个，可跨 Agent、跨模型混合。
- **本机 Agent**：通过 ACP 接入 Pi、Codex、Cursor Agent、DeepSeek Harness 等，模型与思考强度选项从 Agent 实时读取；在 bubblewrap 沙箱中只读运行，可选隔离全局上下文的干净环境。
- **API Provider**：支持 OpenAI 兼容的 Chat Completions 与 Responses 协议，API Key 仅保存在本机。
- **附件**：图片、PDF 与文本随素材提交，按各对象的能力校验。
- **历史与分析**：保留每轮输入快照、输出、重试记录；可让 Agent 基于选中的结果进行分析对话。
- **内容库**：保存常用素材与提示词，新建项目时直接复用。
- **单文件发行版**：Linux x86_64 可执行程序内置运行时与前端，以 systemd 用户服务运行。

## 运行环境

Linux、bubblewrap，以及已安装并登录的 ACP Agent。服务仅监听本机回环地址。

## 许可证

[MIT](LICENSE)
