import type { LibrarySources } from "./schemas.ts";
import type { AgentConfigInput, ProviderInput, ProviderModel } from "./schemas.ts";

export type AttemptStatus = "queued" | "running" | "cancel_requested" | "succeeded" | "failed" | "cancelled" | "interrupted";
export type RunStatus = "queued" | "running" | "succeeded" | "partial" | "cancelled" | "failed";
export type ReadonlyCheck = "passed" | "failed";

export type Page<T> = { items: T[]; next_cursor: string | null };

export type ApiError = {
  error: { code: string; message: string; request_id: string; fields?: Record<string, string> };
};

export type ConfigOptionValue = { value: string; name: string; group: string | null };
export type ConfigOptionView = {
  id: string;
  name: string;
  category: string | null;
  type: string;
  current_value: string | null;
  values: ConfigOptionValue[];
};

export type ProbeResult = {
  probed_at: string;
  protocol_version: number;
  agent_name: string | null;
  agent_version: string | null;
  load_session: boolean;
  resume_session: boolean;
  prompt_capabilities: Record<string, unknown>;
  auth_methods: unknown[];
  config_options: ConfigOptionView[];
  model_catalog?: { config_updated_at: string; models: ModelCatalogEntry[] };
};

export type ModelCatalogEntry = { value: string; name: string; config_options: ConfigOptionView[] };

export type PurityCheck = {
  checked_at: string;
  passed: boolean;
  received_text: string;
  error: string | null;
  config_updated_at: string;
};

export type Capabilities = {
  set_model: boolean;
  report_model: boolean;
  set_thought_level: boolean;
  readonly_mode: boolean;
  resume_session: boolean;
  usage_report: "full" | "context_only" | "none" | "unknown";
};

export type AgentConfigView = AgentConfigInput & {
  id: string;
  is_draft: boolean;
  created_at: string;
  updated_at: string;
  probe: ProbeResult | null;
  purity: PurityCheck | null;
  purity_current: boolean;
  capabilities: Capabilities;
  available: boolean;
  unavailable_reasons: string[];
};

export type ThoughtLevelView = { id: string; name: string; sort: number };

export type ModelOptionView = { value: string; name: string; source: "agent_option" };

export type ThoughtOptionsResult = {
  mode: "option" | "in_model" | "none";
  model_value: string | null;
  thought_config_id: string | null;
  values: ConfigOptionValue[];
  parameters: ConfigOptionView[];
};


export type ProjectSummary = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  run_count: number;
  last_run_at: string | null;
  deleted: boolean;
};

export type ProjectView = ProjectSummary & {
  draft_material: string;
  draft_prompt: string;
  draft_attachments: AttachmentView[];
  draft_version: number;
  draft_sources?: LibrarySources;
};

export type TimingView = {
  queue_ms: number | null;
  startup_ms: number | null;
  ttft_ms: number | null;
  generation_ms: number | null;
  total_ms: number | null;
  started_at: string | null;
  ended_at: string | null;
};

export type UsageView = {
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  thought_tokens: number | null;
  cached_read_tokens: number | null;
  cached_write_tokens: number | null;
  context_used: number | null;
  context_size: number | null;
  cost_amount: number | null;
  cost_currency: string | null;
  prompt_usage_reported: boolean;
  usage_update_reported: boolean;
};

export type AttemptView = {
  id: string;
  target_id: string;
  seq: number;
  status: AttemptStatus;
  agent_name: string | null;
  agent_version: string | null;
  readback_model: string | null;
  readback_thought: string | null;
  readback_readonly: string | null;
  stop_reason: string | null;
  readonly_check: ReadonlyCheck | null;
  readonly_check_detail: string | null;
  config_changed: boolean;
  output_revision: number;
  output_text: string;
  output_complete: boolean;
  timing: TimingView;
  usage: UsageView;
  error: string | null;
  created_at: string;
};

export type AgentTargetSnapshot = {
  kind?: "agent";
  agent_config_id: string;
  agent_config_name: string;
  config: AgentConfigInput;
  base_model: string | null;
  model_value: string | null;
  thought_level_id: string | null;
  thought_level_name: string | null;
  thought_native_value: string | null;
  settings: { kind: "model" | "thought" | "model_parameter" | "readonly"; config_id: string; value: string; name?: string; value_name?: string }[];
};

export type ProviderView = Omit<ProviderInput, "api_key"> & { id: string; has_api_key: boolean };
export type ProviderTargetSnapshot = {
  kind: "provider";
  provider_id: string;
  provider_name: string;
  protocol: ProviderInput["protocol"];
  base_url: string;
  credential_ref: string;
  model_config: ProviderModel;
  base_model: string;
  model_value: string;
  thought_level_id: string | null;
  thought_level_name: string | null;
  thought_native_value: string | null;
};
export type TargetSnapshot = AgentTargetSnapshot | ProviderTargetSnapshot;
export const targetName = (snapshot: TargetSnapshot): string => snapshot.kind === "provider" ? snapshot.provider_name : snapshot.agent_config_name;
export type AttachmentView = { id: string; project_id: string; name: string; mime_type: string; kind: "image" | "pdf" | "text"; size: number; sha256: string; created_at: string };

export type TargetView = {
  id: string;
  position: number;
  snapshot: TargetSnapshot;
  attempts: AttemptView[];
};

export type RunSummary = {
  id: string;
  project_id: string;
  source_run_id: string | null;
  source_run_number: number | null;
  run_number: number;
  title: string;
  target_count: number;
  status: RunStatus;
  prompt_excerpt: string;
  material_excerpt: string | null;
  targets: { label: string; model: string | null; thought_level_name: string | null }[];
  completion: { succeeded: number; total: number };
  created_at: string;
  deleted: boolean;
};

export type RunPacket = {
  schema_version: 6;
  id: string;
  project_id: string;
  source_run_id: string | null;
  run_number: number;
  title: string;
  created_at: string;
  target_count: number;
  status: RunStatus;
  deleted: boolean;
  input: {
    material: string;
    attachments: AttachmentView[];
    library_sources?: LibrarySources;
    content_sha256: string;
    material_sha256: string;
    prompt: string;
    build_version: string;
    submitted_text: string;
    submitted_sha256: string;
  };
  comparison: {
    require_clean: boolean;
  };
  targets: TargetView[];
  execution_context: { events_url: string; note: string };
  snapshot: { read_at: string; event_revision: number };
};

export type ConversationView = {
  id: string;
  project_id: string;
  agent_config_id: string;
  agent_config_name: string;
  model: string | null;
  thought_level_name: string | null;
  scope: { run_ids: string[]; runs: { id: string; run_number: number; title: string }[] };
  generating: boolean;
  created_at: string;
  updated_at: string;
};

export type SendMessageResult = { user: MessageView; assistant: MessageView };

export type MessageSource = {
  run_id: string;
  run_number: number;
  attempt_id: string;
  target_label: string;
  attempt_seq: number;
  revision: number;
  complete: boolean;
  status: AttemptStatus;
  source_deleted: boolean;
};

export type MessageView = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  status: "generating" | "succeeded" | "failed" | "cancelled" | "interrupted";
  sources: MessageSource[];
  error: string | null;
  readonly_check: ReadonlyCheck | null;
  timing: TimingView | null;
  usage: UsageView | null;
  created_at: string;
};

export type StreamEventType =
  | "attempt_update"
  | "message_update"
  | "output_chunk"
  | "thought_chunk"
  | "tool_call"
  | "tool_call_update"
  | "plan"
  | "permission"
  | "usage_update"
  | "config_option_update"
  | "run_update";

export type StreamEvent = {
  seq: number;
  type: StreamEventType;
  attempt_id: string | null;
  message_id: string | null;
  payload: unknown;
  created_at: string;
};

export type LibraryAttachmentView = Omit<AttachmentView, "project_id"> & { library_item_id: string };
export type LibraryItemView = { id: string; kind: "material" | "prompt"; title: string; content: string; attachments: LibraryAttachmentView[]; version: number; created_at: string; updated_at: string; deleted: boolean };
export type LibraryAppliedView = { kind: "material" | "prompt"; content: string; attachments: AttachmentView[]; source: { id: string; version: number; title: string } };
