export const agentProviders = ["codex", "claude", "zcode", "pi"] as const;
export type AgentProvider = (typeof agentProviders)[number];

export const sessionStatuses = [
  "running",
  "completed",
  "needs_attention",
  "interrupted",
  "incomplete",
  "unknown",
] as const;
export type SessionStatus = (typeof sessionStatuses)[number];

export const UNKNOWN_PROJECT_KEY = "(unknown)";
export const TASKS_PROJECT_KEY = "(tasks)";

export interface ActivityEvent {
  externalId: string;
  kind:
    "started" | "tool" | "file" | "command" | "completed" | "warning" | "info";
  title: string;
  detail?: string;
  occurredAt: string;
}

export interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reportedCostUsd?: number;
}

export const costSources = ["reported", "estimated", "unavailable"] as const;
export type CostSource = (typeof costSources)[number];

export interface NormalizedSession {
  externalId: string;
  sourcePath: string;
  provider: AgentProvider;
  title: string;
  summary?: string;
  repository?: string;
  cwd?: string;
  branch?: string;
  status: SessionStatus;
  startedAt: string;
  endedAt?: string;
  updatedAt: string;
  filesChanged?: number;
  additions?: number;
  deletions?: number;
  model?: string;
  usage: ModelUsage[];
  events: ActivityEvent[];
}

export interface SyncError {
  provider: AgentProvider;
  sourcePath: string;
  code: "read_error" | "parse_error" | "unsupported";
  message: string;
  occurredAt: string;
}

export interface ParseResult {
  sessions: NormalizedSession[];
  errors: SyncError[];
}

export interface ProviderAdapter {
  provider: AgentProvider;
  discover(): Promise<string[]>;
  parse(filePath: string): Promise<ParseResult>;
}
