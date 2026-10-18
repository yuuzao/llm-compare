export const SCHEMA_VERSION = 4;

export const SCHEMA_SQL = `
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  draft_material TEXT NOT NULL,
  draft_prompt TEXT NOT NULL,
  draft_attachment_ids TEXT NOT NULL DEFAULT '[]',
  draft_version INTEGER NOT NULL,
  next_run_number INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE material_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  content TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, sha256)
);

CREATE TABLE agent_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  config_json TEXT NOT NULL,
  is_draft INTEGER NOT NULL,
  probe_json TEXT,
  purity_json TEXT,
  usage_report TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE thought_levels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE thought_mappings (
  agent_config_id TEXT NOT NULL REFERENCES agent_configs(id),
  model_value TEXT NOT NULL,
  unsupported INTEGER NOT NULL,
  levels_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (agent_config_id, model_value)
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  run_number INTEGER NOT NULL,
  source_run_id TEXT REFERENCES runs(id),
  title TEXT NOT NULL,
  material_version_id TEXT NOT NULL REFERENCES material_versions(id),
  prompt TEXT NOT NULL,
  build_version TEXT NOT NULL,
  submitted_text TEXT NOT NULL,
  submitted_sha256 TEXT NOT NULL,
  attachment_ids TEXT NOT NULL DEFAULT '[]',
  thought_level_id TEXT,
  thought_level_name TEXT,
  require_clean INTEGER NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (project_id, run_number)
);
CREATE INDEX runs_project_created ON runs(project_id, created_at DESC, id DESC);

CREATE TABLE run_targets (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  position INTEGER NOT NULL,
  agent_config_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  UNIQUE (run_id, position)
);

CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES run_targets(id),
  run_id TEXT NOT NULL REFERENCES runs(id),
  seq INTEGER NOT NULL,
  status TEXT NOT NULL,
  acp_session_id TEXT,
  agent_name TEXT,
  agent_version TEXT,
  readback_model TEXT,
  readback_thought TEXT,
  readback_readonly TEXT,
  stop_reason TEXT,
  readonly_check TEXT,
  readonly_check_detail TEXT,
  config_changed INTEGER NOT NULL,
  cwd TEXT,
  output_text TEXT,
  output_revision INTEGER NOT NULL,
  t_created TEXT NOT NULL,
  t_spawn TEXT,
  t_ready TEXT,
  t_prompt TEXT,
  t_first_chunk TEXT,
  t_end TEXT,
  queue_ms REAL,
  startup_ms REAL,
  ttft_ms REAL,
  generation_ms REAL,
  total_ms REAL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  thought_tokens INTEGER,
  cached_read_tokens INTEGER,
  cached_write_tokens INTEGER,
  prompt_usage_json TEXT,
  context_used INTEGER,
  context_size INTEGER,
  cost_amount REAL,
  cost_currency TEXT,
  usage_update_json TEXT,
  error TEXT,
  UNIQUE (target_id, seq)
);
CREATE INDEX attempts_run ON attempts(run_id);

CREATE TABLE events (
  stream_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  attempt_id TEXT,
  message_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (stream_id, seq)
);
CREATE INDEX events_attempt ON events(attempt_id, seq);
CREATE INDEX events_message ON events(message_id, seq);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  agent_config_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  snapshot_dir TEXT,
  readonly_check TEXT,
  error TEXT,
  timing_json TEXT,
  usage_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX messages_conversation ON messages(conversation_id, created_at);

CREATE TABLE stream_seq (
  stream_id TEXT PRIMARY KEY,
  last_seq INTEGER NOT NULL
);
`;

export const PROVIDER_ATTACHMENT_SQL = `
CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  config_json TEXT NOT NULL,
  credential_ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  kind TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export const LIBRARY_SQL = `
CREATE TABLE library_items (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('material','prompt')), title TEXT NOT NULL,
  content TEXT NOT NULL, attachment_ids TEXT NOT NULL DEFAULT '[]', version INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX library_items_kind_updated ON library_items(kind, updated_at DESC, id DESC);
CREATE TABLE library_attachments (
  id TEXT PRIMARY KEY, library_item_id TEXT NOT NULL REFERENCES library_items(id),
  name TEXT NOT NULL, mime_type TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL,
  sha256 TEXT NOT NULL, created_at TEXT NOT NULL
);
ALTER TABLE projects ADD COLUMN draft_sources TEXT NOT NULL DEFAULT '{}';
ALTER TABLE runs ADD COLUMN library_sources TEXT NOT NULL DEFAULT '{}';
`;
