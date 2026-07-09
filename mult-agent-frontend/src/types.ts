export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskMode = "sequential" | "parallel" | "collaborative";

export interface Task {
  task_id: string;
  name: string;
  description: string;
  mode: TaskMode;
  agents: string[];
  tli_commands: string[];
  workspace_dir?: string;
  status: TaskStatus;
  progress: number;
  created_at: string;
  updated_at: string;
}

export interface LogEntry {
  log_id: number;
  agent_name: string;
  stdout: string;
  stderr: string;
  timestamp: string;
}

export interface ResultEntry {
  result_id: number;
  agent_name: string;
  output: string;
  summary: string;
  created_at: string;
}

export interface TaskDetail extends Task {
  logs: LogEntry[];
  results: ResultEntry[];
}

export interface AgentStatus {
  name: string;
  display_name: string;
  online: boolean;
  type: "cli" | "builtin" | "http" | "mcp" | "mock";
  role: string;
  icon: string;
  color: string;
  description: string;
  enabled: boolean;
}

export interface DiscoverSuggestion {
  name: string;
  display_name: string;
  role: string;
  type: string;
  cli_binary: string;
  args_template: string;
  icon: string;
  color: string;
  available: boolean;
  description?: string;
  stdin_mode?: boolean;
}

export type AgentType = "cli" | "builtin" | "http" | "mcp";

export interface AgentConfig {
  name: string;
  display_name?: string;
  description?: string;
  role?: string;
  type?: AgentType;
  icon?: string;
  color?: string;
  role_hint?: string;
  timeout?: number;

  // CLI 字段
  cli_binary?: string;
  args_template?: string;
  workspace_dir?: string;
  strip_ansi?: boolean;
  model?: string;
  stdin_mode?: boolean;

  // HTTP 字段
  base_url?: string;
  api_key_env?: string;
  system_prompt?: string;
  temperature?: number;
  max_tokens?: number;
  extra_headers?: Record<string, string>;
  mcp_tools?: string[];

  // MCP 字段
  transport?: "stdio" | "sse";
  command?: string;
  mcp_args?: string[];
  env?: Record<string, string>;
  sse_url?: string;
  auto_start?: boolean;
}

export interface AgentTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AgentToolsResponse {
  agent: string;
  transport: string;
  running: boolean;
  tools: AgentTool[];
  error: string;
}

export interface CreateTaskPayload {
  name: string;
  description: string;
  mode: TaskMode;
  agents: string[];
  tli_commands: string[];
  workspace_dir?: string;
}

export interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export interface FsListResponse {
  path: string;
  parent: string | null;
  entries: FsEntry[];
}

export interface FsHomeResponse {
  home: string;
  roots: { label: string; path: string }[];
}

export interface KnowledgeEntry {
  id: number;
  task_id: string;
  agent_name: string;
  summary: string;
  question: string;
  feedback: string;
  category: string;
  keywords: string[];
  relevance: number;
}

export interface KnowledgeResponse {
  entries: KnowledgeEntry[];
  total: number;
}

export interface ContinuePayload {
  agent: string;
  question: string;
}

export interface ApprovalPayload {
  response: string;
}

export interface AgentMessage {
  id: number;
  task_id: string;
  round: number;
  from_agent: string;
  to_agent: string | null;
  topic: string | null;
  content: string;
  created_at: string;
}
