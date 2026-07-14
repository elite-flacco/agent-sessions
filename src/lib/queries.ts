import fs from "node:fs";
import path from "node:path";
import { sqlite } from "@/db/client";
import { normalizeModel, usageCostUsd } from "./pricing";
import {
  UNKNOWN_PROJECT_KEY,
  TASKS_PROJECT_KEY,
  type AgentProvider,
  type CostSource,
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
 * window reads as incomplete. Interrupted is reserved for an explicit
 * provider abort or cancellation marker.
 */
const statusExpression = (column: string, updatedColumn: string) =>
  `CASE WHEN ${column} = 'running' AND ${updatedColumn} < ? THEN 'incomplete' ELSE ${column} END`;

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
    // SQLite gives backslash no meaning in LIKE unless ESCAPE declares it.
    clauses.push(
      "(title LIKE ? ESCAPE '\\' OR repository LIKE ? ESCAPE '\\' OR branch LIKE ? ESCAPE '\\')",
    );
    const query = `%${filters.q
      .replaceAll("\\", "\\\\")
      .replaceAll("%", "\\%")
      .replaceAll("_", "\\_")}%`;
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
  const clauses = ["s.status = 'running' AND s.updated_at >= ?"];
  const params: unknown[] = [staleCutoff()];
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
  category: "project" | "task";
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

function gitRoot(cwd: string): string | null {
  let current = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isRepositoryBacked(row: ProjectRow): boolean {
  if (
    (row.branches?.split(",") ?? []).some(
      (branch) => branch.toUpperCase() !== "HEAD",
    )
  )
    return true;
  return (row.workdirs?.split(",") ?? []).some((cwd) => gitRoot(cwd));
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
  const summaries: ProjectSummary[] = rows.map((row) => ({
    key: row.repository ?? UNKNOWN_PROJECT_KEY,
    repository: row.repository,
    category: isRepositoryBacked(row) ? "project" : "task",
    sessionCount: row.sessionCount,
    activeCount: row.activeCount,
    providers: (row.providers?.split(",") ?? []) as AgentProvider[],
    branches: row.branches?.split(",") ?? [],
    workdirs: row.workdirs?.split(",") ?? [],
    totalRuntimeMs: row.totalRuntimeMs,
    lastActivityAt: row.lastActivityAt,
  }));
  const projects = summaries.filter(
    (summary) => summary.category === "project",
  );
  const tasks = summaries.filter((summary) => summary.category === "task");
  if (!tasks.length) return projects;
  return [
    ...projects,
    {
      key: TASKS_PROJECT_KEY,
      repository: null,
      category: "task",
      sessionCount: tasks.reduce((total, task) => total + task.sessionCount, 0),
      activeCount: tasks.reduce((total, task) => total + task.activeCount, 0),
      providers: unique(tasks.flatMap((task) => task.providers)),
      branches: [],
      workdirs: unique(tasks.flatMap((task) => task.workdirs)),
      totalRuntimeMs: tasks.reduce(
        (total, task) => total + task.totalRuntimeMs,
        0,
      ),
      lastActivityAt: tasks.reduce(
        (latest, task) =>
          task.lastActivityAt > latest ? task.lastActivityAt : latest,
        tasks[0].lastActivityAt,
      ),
    },
  ];
}

export function getProjectSessions(key: string): SessionListItem[] {
  const status = statusExpression("status", "updated_at");
  const repositoryKeys = getProjects()
    .filter((project) => project.category === "project")
    .map((project) => project.key);
  const isTasks = key === TASKS_PROJECT_KEY || key === UNKNOWN_PROJECT_KEY;
  const where = isTasks
    ? repositoryKeys.length
      ? `repository IS NULL OR repository NOT IN (${repositoryKeys.map(() => "?").join(", ")})`
      : "1 = 1"
    : "repository = ?";
  const params: unknown[] = isTasks
    ? [staleCutoff(), ...repositoryKeys]
    : [staleCutoff(), key];
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

interface UsageJoinRow {
  sessionId: number;
  provider: AgentProvider;
  repository: string | null;
  startedAt: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reportedCostUsd: number | null;
}

const USAGE_JOIN = `SELECT u.session_id sessionId, s.provider, s.repository, s.started_at startedAt,
  u.model, u.input_tokens inputTokens, u.output_tokens outputTokens,
  u.cache_read_tokens cacheReadTokens, u.cache_write_tokens cacheWriteTokens,
  u.reported_cost_usd reportedCostUsd
  FROM session_model_usage u JOIN sessions s ON s.id = u.session_id`;

function rowCost(row: UsageJoinRow): number | undefined {
  return usageCostUsd(
    {
      model: row.model,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheWriteTokens: row.cacheWriteTokens,
      reportedCostUsd: row.reportedCostUsd ?? undefined,
    },
    row.startedAt,
  );
}

export interface SessionUsageDetail {
  models: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  }[];
  costUsd: number | null;
  costSource: CostSource;
}

/**
 * Cost is derived at read time (never stored) so pricing-table updates
 * apply retroactively. Per the pricing-trust rule, a session only gets a
 * dollar figure when every token-bearing row is priced — either reported
 * by the provider or matched to a pricing entry.
 */
export function getSessionUsage(sessionId: number): SessionUsageDetail {
  const rows = sqlite
    .prepare(`${USAGE_JOIN} WHERE u.session_id = ?`)
    .all(sessionId) as UsageJoinRow[];
  let costUsd = 0;
  let priced = true;
  let reported = rows.length > 0;
  for (const row of rows) {
    const cost = rowCost(row);
    if (cost === undefined) priced = false;
    else costUsd += cost;
    if (row.reportedCostUsd === null) reported = false;
  }
  return {
    models: rows.map((row) => ({
      model: row.model,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheWriteTokens: row.cacheWriteTokens,
    })),
    costUsd: rows.length && priced ? costUsd : null,
    costSource:
      rows.length && priced
        ? reported
          ? "reported"
          : "estimated"
        : "unavailable",
  };
}

export interface UsageBucket {
  key: string;
  costUsd: number;
  tokens: number;
  sessions: number;
}

export interface UsageWindow {
  costUsd: number;
  tokens: number;
  cacheReadTokens: number;
  sessions: number;
  unpricedSessions: number;
}

export interface UsageSummary {
  today: UsageWindow;
  week: UsageWindow;
  month: UsageWindow;
  daily: { date: string; costUsd: number; tokens: number }[];
  byProvider: UsageBucket[];
  byModel: UsageBucket[];
  byProject: UsageBucket[];
}

const USAGE_DAYS = 30;

/**
 * Aggregates the last 30 days of per-session per-model usage. Sessions with
 * any unpriced usage are excluded from dollar sums (and counted in
 * unpricedSessions) but still contribute to token totals. The by-model
 * buckets attribute dollars per model instead, so byModel cost can exceed
 * the window totals when priced and unpriced models share a session.
 * Buckets cover the full 30-day window; a session's usage is attributed to
 * its start date.
 */
export function getUsageSummary(): UsageSummary {
  const since = new Date(Date.now() - USAGE_DAYS * DAY_MS).toISOString();
  const rows = sqlite
    .prepare(`${USAGE_JOIN} WHERE s.started_at >= ?`)
    .all(since) as UsageJoinRow[];

  interface SessionAccumulator {
    provider: AgentProvider;
    repository: string | null;
    startedAt: string;
    tokens: number;
    cacheReadTokens: number;
    costUsd: number;
    priced: boolean;
    models: Map<string, { tokens: number; costUsd: number; priced: boolean }>;
  }
  const bySession = new Map<number, SessionAccumulator>();
  for (const row of rows) {
    const entry = bySession.get(row.sessionId) ?? {
      provider: row.provider,
      repository: row.repository,
      startedAt: row.startedAt,
      tokens: 0,
      cacheReadTokens: 0,
      costUsd: 0,
      priced: true,
      models: new Map(),
    };
    const tokens =
      row.inputTokens +
      row.outputTokens +
      row.cacheReadTokens +
      row.cacheWriteTokens;
    const cost = rowCost(row);
    entry.tokens += tokens;
    entry.cacheReadTokens += row.cacheReadTokens;
    if (cost === undefined) entry.priced = false;
    else entry.costUsd += cost;
    const modelKey = normalizeModel(row.model);
    const model = entry.models.get(modelKey) ?? {
      tokens: 0,
      costUsd: 0,
      priced: true,
    };
    model.tokens += tokens;
    if (cost === undefined) model.priced = false;
    else model.costUsd += cost;
    entry.models.set(modelKey, model);
    bySession.set(row.sessionId, entry);
  }

  const emptyWindow = (): UsageWindow => ({
    costUsd: 0,
    tokens: 0,
    cacheReadTokens: 0,
    sessions: 0,
    unpricedSessions: 0,
  });
  const today = emptyWindow();
  const week = emptyWindow();
  const month = emptyWindow();
  const todayStart = startOfToday();
  const weekStart = new Date(Date.now() - 7 * DAY_MS).toISOString();
  const daily = new Map<string, { costUsd: number; tokens: number }>();
  const byProvider = new Map<string, UsageBucket>();
  const byModel = new Map<string, UsageBucket>();
  const byProject = new Map<string, UsageBucket>();
  const addBucket = (
    map: Map<string, UsageBucket>,
    key: string,
    costUsd: number,
    tokens: number,
  ) => {
    const bucket = map.get(key) ?? { key, costUsd: 0, tokens: 0, sessions: 0 };
    bucket.costUsd += costUsd;
    bucket.tokens += tokens;
    bucket.sessions += 1;
    map.set(key, bucket);
  };

  for (const session of bySession.values()) {
    const costUsd = session.priced ? session.costUsd : 0;
    const windows = [month];
    if (session.startedAt >= weekStart) windows.push(week);
    if (session.startedAt >= todayStart) windows.push(today);
    for (const window of windows) {
      window.tokens += session.tokens;
      window.cacheReadTokens += session.cacheReadTokens;
      window.sessions += 1;
      if (session.priced) window.costUsd += costUsd;
      else window.unpricedSessions += 1;
    }
    const day = session.startedAt.slice(0, 10);
    const dayEntry = daily.get(day) ?? { costUsd: 0, tokens: 0 };
    dayEntry.costUsd += costUsd;
    dayEntry.tokens += session.tokens;
    daily.set(day, dayEntry);
    addBucket(byProvider, session.provider, costUsd, session.tokens);
    addBucket(
      byProject,
      session.repository ?? UNKNOWN_PROJECT_KEY,
      costUsd,
      session.tokens,
    );
    // Cost is attributed per model, not per session: a priced model keeps
    // its dollars even when a sibling model in the same session is unpriced
    // (that session is still excluded from the window dollar sums above).
    for (const [model, totals] of session.models) {
      addBucket(
        byModel,
        model,
        totals.priced ? totals.costUsd : 0,
        totals.tokens,
      );
    }
  }

  const dailySeries = Array.from({ length: USAGE_DAYS }, (_, index) => {
    const date = new Date(Date.now() - (USAGE_DAYS - 1 - index) * DAY_MS)
      .toISOString()
      .slice(0, 10);
    return { date, ...(daily.get(date) ?? { costUsd: 0, tokens: 0 }) };
  });
  const ranked = (map: Map<string, UsageBucket>) =>
    [...map.values()].sort(
      (a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens,
    );

  return {
    today,
    week,
    month,
    daily: dailySeries,
    byProvider: ranked(byProvider),
    byModel: ranked(byModel),
    byProject: ranked(byProject),
  };
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
