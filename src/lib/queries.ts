import { sqlite } from "@/db/client";
import type { AgentProvider, SessionStatus } from "./types";

export interface SessionListItem {
  id: number;
  externalId: string;
  provider: AgentProvider;
  title: string;
  summary: string | null;
  repository: string | null;
  cwd: string | null;
  branch: string | null;
  status: SessionStatus;
  startedAt: string;
  endedAt: string | null;
  updatedAt: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  model: string | null;
  estimatedCostUsd: number | null;
}

export interface SessionEventRow {
  id: number;
  kind: string;
  title: string;
  detail: string | null;
  occurredAt: string;
}

export interface SessionFilters {
  q?: string;
  provider?: string;
  status?: string;
  range?: string;
  selected?: string;
}

function cutoff(range?: string): string | undefined {
  const days =
    range === "today"
      ? 1
      : range === "30d"
        ? 30
        : range === "all"
          ? undefined
          : 7;
  return days
    ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    : undefined;
}

export function getSessions(filters: SessionFilters): SessionListItem[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.q) {
    clauses.push("(title LIKE ? OR repository LIKE ? OR branch LIKE ?)");
    const query = `%${filters.q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    params.push(query, query, query);
  }
  if (filters.provider && filters.provider !== "all") {
    clauses.push("provider = ?");
    params.push(filters.provider);
  }
  if (filters.status && filters.status !== "all") {
    clauses.push("status = ?");
    params.push(filters.status);
  }
  const date = cutoff(filters.range);
  if (date) {
    clauses.push("started_at >= ?");
    params.push(date);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return sqlite
    .prepare(
      `SELECT id, external_id externalId, provider, title, summary, repository, cwd, branch, status,
    started_at startedAt, ended_at endedAt, updated_at updatedAt, input_tokens inputTokens, output_tokens outputTokens,
    cached_tokens cachedTokens, model, estimated_cost_usd estimatedCostUsd FROM sessions ${where} ORDER BY started_at DESC LIMIT 250`,
    )
    .all(...params) as SessionListItem[];
}

export function getSessionEvents(sessionId: number): SessionEventRow[] {
  return sqlite
    .prepare(
      "SELECT id, kind, title, detail, occurred_at occurredAt FROM activity_events WHERE session_id = ? ORDER BY occurred_at DESC LIMIT 40",
    )
    .all(sessionId) as SessionEventRow[];
}

export function getSummary(): {
  sessionsToday: number;
  activeNow: number;
  totalRuntimeMs: number;
  connectedAgents: number;
} {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sessionsToday = (
    sqlite
      .prepare("SELECT COUNT(*) count FROM sessions WHERE started_at >= ?")
      .get(today.toISOString()) as { count: number }
  ).count;
  const activeNow = (
    sqlite
      .prepare("SELECT COUNT(*) count FROM sessions WHERE status = 'running'")
      .get() as { count: number }
  ).count;
  const totalRuntimeMs = (
    sqlite
      .prepare(
        "SELECT COALESCE(SUM((julianday(COALESCE(ended_at, updated_at)) - julianday(started_at)) * 86400000), 0) total FROM sessions WHERE started_at >= ?",
      )
      .get(today.toISOString()) as { total: number }
  ).total;
  const connectedAgents = (
    sqlite
      .prepare(
        "SELECT COUNT(DISTINCT provider) count FROM ingestion_sources WHERE parse_state = 'ok'",
      )
      .get() as { count: number }
  ).count;
  return { sessionsToday, activeNow, totalRuntimeMs, connectedAgents };
}

export interface ActivityStreamRow {
  id: number;
  kind: string;
  title: string;
  detail: string | null;
  occurredAt: string;
  sessionId: number;
  sessionTitle: string;
  provider: AgentProvider;
  repository: string | null;
  branch: string | null;
  sessionStatus: SessionStatus;
}

export interface ActivityStreamFilters {
  provider?: string;
  repo?: string;
}

export function getActivityStream(
  filters: ActivityStreamFilters,
  limit = 120,
): ActivityStreamRow[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.provider && filters.provider !== "all") {
    clauses.push("s.provider = ?");
    params.push(filters.provider);
  }
  if (filters.repo && filters.repo !== "all") {
    if (filters.repo === "unknown") clauses.push("s.repository IS NULL");
    else {
      clauses.push("s.repository = ?");
      params.push(filters.repo);
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return sqlite
    .prepare(
      `SELECT e.id, e.kind, e.title, e.detail, e.occurred_at occurredAt,
        s.id sessionId, s.title sessionTitle, s.provider, s.repository, s.branch, s.status sessionStatus
      FROM activity_events e JOIN sessions s ON s.id = e.session_id ${where}
      ORDER BY e.occurred_at DESC, e.id DESC LIMIT ?`,
    )
    .all(...params, limit) as ActivityStreamRow[];
}

export function getRepositories(): string[] {
  return (
    sqlite
      .prepare(
        "SELECT DISTINCT repository FROM sessions WHERE repository IS NOT NULL ORDER BY repository COLLATE NOCASE",
      )
      .all() as { repository: string }[]
  ).map((row) => row.repository);
}

export function countSessions(): number {
  return (
    sqlite.prepare("SELECT COUNT(*) count FROM sessions").get() as {
      count: number;
    }
  ).count;
}

export interface CollectorHealth {
  sources: number;
  parseErrors: number;
  recentSyncErrors: number;
  lastSyncedAt: string | null;
  connectedAgents: number;
}

export function getCollectorHealth(): CollectorHealth {
  const sourceState = sqlite
    .prepare(
      `SELECT COUNT(*) sources,
        COALESCE(SUM(CASE WHEN parse_state = 'error' THEN 1 ELSE 0 END), 0) parseErrors,
        MAX(last_synced_at) lastSyncedAt,
        COUNT(DISTINCT CASE WHEN parse_state = 'ok' THEN provider END) connectedAgents
      FROM ingestion_sources`,
    )
    .get() as {
    sources: number;
    parseErrors: number;
    lastSyncedAt: string | null;
    connectedAgents: number;
  };
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recentSyncErrors = (
    sqlite
      .prepare("SELECT COUNT(*) count FROM sync_errors WHERE occurred_at >= ?")
      .get(dayAgo) as { count: number }
  ).count;
  return { ...sourceState, recentSyncErrors };
}

export function getSyncState(): {
  lastSyncedAt: string | null;
  errors: number;
  sources: number;
} {
  return sqlite
    .prepare(
      "SELECT MAX(last_synced_at) lastSyncedAt, SUM(CASE WHEN parse_state = 'error' THEN 1 ELSE 0 END) errors, COUNT(*) sources FROM ingestion_sources",
    )
    .get() as { lastSyncedAt: string | null; errors: number; sources: number };
}
