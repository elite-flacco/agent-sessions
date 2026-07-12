import { sqlite } from "@/db/client";
import {
  UNKNOWN_PROJECT_KEY,
  type AgentProvider,
  type SessionStatus,
} from "./types";

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

const STALE_RUNNING_MS = 10 * 60 * 1000;

/**
 * Sessions are stored with the status derived at parse time, which goes
 * stale when a source file stops changing. Derive the effective status at
 * query time instead: a "running" session with no updates inside the stale
 * window reads as interrupted.
 */
const statusExpression = (column: string, updatedColumn: string) =>
  `CASE WHEN ${column} = 'running' AND ${updatedColumn} < ? THEN 'interrupted' ELSE ${column} END`;

function staleCutoff(): string {
  return new Date(Date.now() - STALE_RUNNING_MS).toISOString();
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
  const status = statusExpression("status", "updated_at");
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
    clauses.push(`${status} = ?`);
    params.push(staleCutoff(), filters.status);
  }
  const date = cutoff(filters.range);
  if (date) {
    clauses.push("started_at >= ?");
    params.push(date);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return sqlite
    .prepare(
      `SELECT id, external_id externalId, provider, title, summary, repository, cwd, branch, ${status} status,
    started_at startedAt, ended_at endedAt, updated_at updatedAt, input_tokens inputTokens, output_tokens outputTokens,
    cached_tokens cachedTokens, model, estimated_cost_usd estimatedCostUsd FROM sessions ${where} ORDER BY started_at DESC LIMIT 250`,
    )
    .all(staleCutoff(), ...params) as SessionListItem[];
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
      .prepare(
        "SELECT COUNT(*) count FROM sessions WHERE status = 'running' AND updated_at >= ?",
      )
      .get(staleCutoff()) as { count: number }
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
        s.id sessionId, s.title sessionTitle, s.provider, s.repository, s.branch,
        ${statusExpression("s.status", "s.updated_at")} sessionStatus
      FROM activity_events e JOIN sessions s ON s.id = e.session_id ${where}
      ORDER BY e.occurred_at DESC, e.id DESC LIMIT ?`,
    )
    .all(staleCutoff(), ...params, limit) as ActivityStreamRow[];
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

export interface ProjectSummary {
  key: string;
  repository: string | null;
  sessionCount: number;
  activeCount: number;
  providers: AgentProvider[];
  branches: string[];
  workdirs: string[];
  totalRuntimeMs: number;
  lastActivityAt: string;
}

interface ProjectRow {
  repository: string | null;
  sessionCount: number;
  activeCount: number;
  providers: string | null;
  branches: string | null;
  workdirs: string | null;
  totalRuntimeMs: number;
  lastActivityAt: string;
}

export function getProjects(): ProjectSummary[] {
  const rows = sqlite
    .prepare(
      `SELECT repository,
        COUNT(*) sessionCount,
        SUM(CASE WHEN status = 'running' AND updated_at >= ? THEN 1 ELSE 0 END) activeCount,
        GROUP_CONCAT(DISTINCT provider) providers,
        GROUP_CONCAT(DISTINCT branch) branches,
        GROUP_CONCAT(DISTINCT cwd) workdirs,
        COALESCE(SUM((julianday(COALESCE(ended_at, updated_at)) - julianday(started_at)) * 86400000), 0) totalRuntimeMs,
        MAX(updated_at) lastActivityAt
      FROM sessions GROUP BY repository ORDER BY lastActivityAt DESC`,
    )
    .all(staleCutoff()) as ProjectRow[];
  return rows.map((row) => ({
    key: row.repository ?? UNKNOWN_PROJECT_KEY,
    repository: row.repository,
    sessionCount: row.sessionCount,
    activeCount: row.activeCount,
    providers: (row.providers?.split(",") ?? []) as AgentProvider[],
    branches: row.branches?.split(",") ?? [],
    workdirs: row.workdirs?.split(",") ?? [],
    totalRuntimeMs: row.totalRuntimeMs,
    lastActivityAt: row.lastActivityAt,
  }));
}

export function getProjectSessions(key: string): SessionListItem[] {
  const status = statusExpression("status", "updated_at");
  const where =
    key === UNKNOWN_PROJECT_KEY ? "repository IS NULL" : "repository = ?";
  const params: unknown[] =
    key === UNKNOWN_PROJECT_KEY ? [staleCutoff()] : [staleCutoff(), key];
  return sqlite
    .prepare(
      `SELECT id, external_id externalId, provider, title, summary, repository, cwd, branch, ${status} status,
    started_at startedAt, ended_at endedAt, updated_at updatedAt, input_tokens inputTokens, output_tokens outputTokens,
    cached_tokens cachedTokens, model, estimated_cost_usd estimatedCostUsd FROM sessions WHERE ${where}
    ORDER BY started_at DESC LIMIT 50`,
    )
    .all(...params) as SessionListItem[];
}

export interface OverviewData {
  today: { sessions: number; runtimeMs: number; events: number };
  week: {
    sessions: number;
    runtimeMs: number;
    events: number;
    failures: number;
  };
  providerCounts: { provider: AgentProvider; count: number }[];
  daily: { date: string; count: number }[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfToday(): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.toISOString();
}

export function getOverview(): OverviewData {
  const todayStart = startOfToday();
  const weekStart = new Date(Date.now() - 7 * DAY_MS).toISOString();
  const status = statusExpression("status", "updated_at");

  const windowStats = (since: string) =>
    sqlite
      .prepare(
        `SELECT COUNT(*) sessions,
          COALESCE(SUM((julianday(COALESCE(ended_at, updated_at)) - julianday(started_at)) * 86400000), 0) runtimeMs,
          COALESCE(SUM(CASE WHEN ${status} IN ('interrupted', 'needs_attention') THEN 1 ELSE 0 END), 0) failures
        FROM sessions WHERE started_at >= ?`,
      )
      .get(staleCutoff(), since) as {
      sessions: number;
      runtimeMs: number;
      failures: number;
    };
  const events = (since: string) =>
    (
      sqlite
        .prepare(
          "SELECT COUNT(*) count FROM activity_events WHERE occurred_at >= ?",
        )
        .get(since) as { count: number }
    ).count;

  const today = windowStats(todayStart);
  const week = windowStats(weekStart);
  const providerCounts = sqlite
    .prepare(
      `SELECT provider, COUNT(*) count FROM sessions WHERE started_at >= ?
      GROUP BY provider ORDER BY count DESC`,
    )
    .all(weekStart) as { provider: AgentProvider; count: number }[];

  const dailyRows = sqlite
    .prepare(
      `SELECT date(started_at) date, COUNT(*) count FROM sessions
      WHERE started_at >= ? GROUP BY date(started_at)`,
    )
    .all(new Date(Date.now() - 13 * DAY_MS).toISOString()) as {
    date: string;
    count: number;
  }[];
  const counts = new Map(dailyRows.map((row) => [row.date, row.count]));
  const daily = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(Date.now() - (13 - index) * DAY_MS)
      .toISOString()
      .slice(0, 10);
    return { date, count: counts.get(date) ?? 0 };
  });

  return {
    today: {
      sessions: today.sessions,
      runtimeMs: today.runtimeMs,
      events: events(todayStart),
    },
    week: {
      sessions: week.sessions,
      runtimeMs: week.runtimeMs,
      events: events(weekStart),
      failures: week.failures,
    },
    providerCounts,
    daily,
  };
}

export function getRunningSessions(limit = 8): SessionListItem[] {
  const status = statusExpression("status", "updated_at");
  return sqlite
    .prepare(
      `SELECT id, external_id externalId, provider, title, summary, repository, cwd, branch, ${status} status,
    started_at startedAt, ended_at endedAt, updated_at updatedAt, input_tokens inputTokens, output_tokens outputTokens,
    cached_tokens cachedTokens, model, estimated_cost_usd estimatedCostUsd FROM sessions
    WHERE status = 'running' AND updated_at >= ? ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(staleCutoff(), staleCutoff(), limit) as SessionListItem[];
}

export function getAttentionSessions(limit = 8): SessionListItem[] {
  const status = statusExpression("status", "updated_at");
  const dayAgo = new Date(Date.now() - DAY_MS).toISOString();
  return sqlite
    .prepare(
      `SELECT id, external_id externalId, provider, title, summary, repository, cwd, branch, ${status} status,
    started_at startedAt, ended_at endedAt, updated_at updatedAt, input_tokens inputTokens, output_tokens outputTokens,
    cached_tokens cachedTokens, model, estimated_cost_usd estimatedCostUsd FROM sessions
    WHERE ${status} IN ('interrupted', 'needs_attention') AND updated_at >= ?
    ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(staleCutoff(), staleCutoff(), dayAgo, limit) as SessionListItem[];
}

export interface CollectorHealth {
  sources: number;
  parseErrors: number;
  recentSyncErrors: number;
  lastSyncedAt: string | null;
  connectedAgents: number;
  delayedProviders: string[];
}

const DELAYED_SCAN_MS = 15 * 60 * 1000;

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
  const delayedProviders = (
    sqlite
      .prepare(
        "SELECT provider FROM adapter_scans WHERE last_scan_at < ? ORDER BY provider",
      )
      .all(new Date(Date.now() - DELAYED_SCAN_MS).toISOString()) as {
      provider: string;
    }[]
  ).map((row) => row.provider);
  return { ...sourceState, recentSyncErrors, delayedProviders };
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
