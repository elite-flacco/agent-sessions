export const agentProviders = ["codex", "claude", "zcode", "pi"] as const;
export type AgentProvider = (typeof agentProviders)[number];

export const sessionStatuses = [
  "running",
  "completed",
  "needs_attention",
  "interrupted",
  "unknown",
] as const;
export type SessionStatus = (typeof sessionStatuses)[number];

export const UNKNOWN_PROJECT_KEY = "(unknown)";

export interface ActivityEvent {
  externalId: string;
  kind:
    "started" | "tool" | "file" | "command" | "completed" | "warning" | "info";
  title: string;
  detail?: string;
  occurredAt: string;
}

export interface UsageRecord {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  model?: string;
  estimatedCostUsd?: number;
}

export interface NormalizedSession {
  externalId: string;
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
  usage?: UsageRecord;
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
