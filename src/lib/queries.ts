import fs from "node:fs";
import path from "node:path";
import { sqlite } from "@/db/client";
import { findPricing, normalizeModel, usageCostUsd } from "./pricing";
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
  parentExternalId: string | null;
  sessionKind: "main" | "subagent";
  agentLabel: string | null;
  agentDepth: number;
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
  /** Read-time derived cost (pricing-trust rule); absent when not computed. */
  costUsd?: number | null;
}

export interface SessionTreeItem extends SessionListItem {
  children: SessionTreeItem[];
}

export interface SessionDetail extends SessionListItem {
  sourcePath: string | null;
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
  sort?: string;
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

function nestSessions(sessions: SessionListItem[]): SessionTreeItem[] {
  const nodes = new Map<string, SessionTreeItem>();
  for (const session of sessions)
    nodes.set(`${session.provider}:${session.externalId}`, {
      ...session,
      children: [],
    });
  const roots: SessionTreeItem[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentExternalId
      ? nodes.get(`${node.provider}:${node.parentExternalId}`)
      : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  for (const node of nodes.values())
    node.children.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return roots;
}

function sessionRuntimeMs(session: SessionListItem): number {
  return (
    new Date(session.endedAt ?? session.updatedAt).getTime() -
    new Date(session.startedAt).getTime()
  );
}

export function getSessions(filters: SessionFilters): SessionTreeItem[] {
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
    // "attention" is a pseudo-status matching every session that failed:
    // it must stay in sync with the overview failure count and lists.
    if (filters.status === "attention") {
      clauses.push(`${status} IN ('interrupted', 'needs_attention')`);
      params.push(staleCutoff());
    } else {
      clauses.push(`${status} = ?`);
      params.push(staleCutoff(), filters.status);
    }
  }
  const date = cutoff(filters.range);
  if (date) {
    clauses.push("started_at >= ?");
    params.push(date);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const sessions = sqlite
    .prepare(
      `SELECT id, external_id externalId, provider, parent_external_id parentExternalId,
      session_kind sessionKind, agent_label agentLabel, agent_depth agentDepth,
      title, summary, repository, cwd, branch, ${status} status,
    started_at startedAt, ended_at endedAt, updated_at updatedAt, input_tokens inputTokens, output_tokens outputTokens,
    cached_tokens cachedTokens, model, estimated_cost_usd estimatedCostUsd FROM sessions ${where} ORDER BY started_at DESC LIMIT 250`,
    )
    .all(staleCutoff(), ...params) as SessionListItem[];
  const costs = getSessionsCostUsd(sessions.map((session) => session.id));
  for (const session of sessions)
    session.costUsd = costs.get(session.id) ?? null;
  const roots = nestSessions(sessions);
  if (filters.sort === "duration")
    roots.sort((a, b) => sessionRuntimeMs(b) - sessionRuntimeMs(a));
  else if (filters.sort === "cost")
    roots.sort((a, b) => (b.costUsd ?? -1) - (a.costUsd ?? -1));
  return roots;
}

export function getSessionEvents(sessionId: number): SessionEventRow[] {
  return sqlite
    .prepare(
      "SELECT id, kind, title, detail, occurred_at occurredAt FROM activity_events WHERE session_id = ? ORDER BY occurred_at DESC LIMIT 40",
    )
    .all(sessionId) as SessionEventRow[];
}

export function getSession(sessionId: number): SessionDetail | null {
  const status = statusExpression("status", "updated_at");
  return (
    (sqlite
      .prepare(
        `SELECT id, external_id externalId, source_path sourcePath, provider,
        parent_external_id parentExternalId, session_kind sessionKind, agent_label agentLabel, agent_depth agentDepth,
        title, summary, repository, cwd, branch,
        ${status} status, started_at startedAt, ended_at endedAt, updated_at updatedAt, input_tokens inputTokens,
        output_tokens outputTokens, cached_tokens cachedTokens, model, estimated_cost_usd estimatedCostUsd
        FROM sessions WHERE id = ?`,
      )
      .get(staleCutoff(), sessionId) as SessionDetail | undefined) ?? null
  );
}

export function getSessionChildren(session: SessionDetail): SessionListItem[] {
  const status = statusExpression("status", "updated_at");
  return sqlite
    .prepare(
      `SELECT id, external_id externalId, provider, parent_external_id parentExternalId,
       session_kind sessionKind, agent_label agentLabel, agent_depth agentDepth,
       title, summary, repository, cwd, branch, ${status} status,
       started_at startedAt, ended_at endedAt, updated_at updatedAt, input_tokens inputTokens,
       output_tokens outputTokens, cached_tokens cachedTokens, model, estimated_cost_usd estimatedCostUsd
       FROM sessions WHERE provider = ? AND parent_external_id = ? ORDER BY started_at`,
    )
    .all(
      staleCutoff(),
      session.provider,
      session.externalId,
    ) as SessionListItem[];
}

export function getSessionParent(
  session: SessionDetail,
): SessionListItem | null {
  if (!session.parentExternalId) return null;
  const status = statusExpression("status", "updated_at");
  return (
    (sqlite
      .prepare(
        `SELECT id, external_id externalId, provider, parent_external_id parentExternalId,
         session_kind sessionKind, agent_label agentLabel, agent_depth agentDepth,
         title, summary, repository, cwd, branch, ${status} status,
         started_at startedAt, ended_at endedAt, updated_at updatedAt, input_tokens inputTokens,
         output_tokens outputTokens, cached_tokens cachedTokens, model, estimated_cost_usd estimatedCostUsd
         FROM sessions WHERE provider = ? AND external_id = ?`,
      )
      .get(staleCutoff(), session.provider, session.parentExternalId) as
      SessionListItem | undefined) ?? null
  );
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

function projectsFromSessions(sessions: SessionListItem[]): ProjectSummary[] {
  const byRepository = new Map<string | null, SessionListItem[]>();
  for (const session of sessions) {
    const group = byRepository.get(session.repository) ?? [];
    group.push(session);
    byRepository.set(session.repository, group);
  }
  const rows: ProjectRow[] = [...byRepository.entries()].map(
    ([repository, group]) => {
      const branches = unique(
        group.flatMap((session) => (session.branch ? [session.branch] : [])),
      );
      const workdirs = unique(
        group.flatMap((session) => (session.cwd ? [session.cwd] : [])),
      );
      return {
        repository,
        sessionCount: group.length,
        activeCount: group.filter((session) => session.status === "running")
          .length,
        providers: unique(group.map((session) => session.provider)).join(","),
        branches: branches.length ? branches.join(",") : null,
        workdirs: workdirs.length ? workdirs.join(",") : null,
        totalRuntimeMs: group.reduce(
          (total, session) =>
            total +
            Math.max(
              0,
              new Date(session.endedAt ?? session.updatedAt).getTime() -
                new Date(session.startedAt).getTime(),
            ),
          0,
        ),
        lastActivityAt: group.reduce(
          (latest, session) =>
            session.updatedAt > latest ? session.updatedAt : latest,
          group[0].updatedAt,
        ),
      };
    },
  );
  return summarizeProjects(rows);
}

function summarizeProjects(rows: ProjectRow[]): ProjectSummary[] {
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

export function getProjects(filters?: SessionFilters): ProjectSummary[] {
  if (filters) return projectsFromSessions(getSessions(filters));
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
  return summarizeProjects(rows);
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
      `SELECT id, external_id externalId, provider, parent_external_id parentExternalId,
      session_kind sessionKind, agent_label agentLabel, agent_depth agentDepth,
      title, summary, repository, cwd, branch, ${status} status,
    started_at startedAt, ended_at endedAt, updated_at updatedAt, input_tokens inputTokens, output_tokens outputTokens,
    cached_tokens cachedTokens, model, estimated_cost_usd estimatedCostUsd FROM sessions WHERE ${where}
    ORDER BY started_at DESC LIMIT 50`,
    )
    .all(...params) as SessionListItem[];
}

export interface OverviewPatterns {
  heatmap: { day: string; count: number }[];
  length: {
    buckets: { label: string; count: number }[];
    medianMs: number | null;
    longestMs: number | null;
    longTailShare: number | null;
    sessionCount: number;
  };
  costWeek: {
    costUsd: number | null;
    tokens: number;
    topModels: { model: string; costUsd: number }[];
  };
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
      `SELECT id, external_id externalId, provider, parent_external_id parentExternalId,
      session_kind sessionKind, agent_label agentLabel, agent_depth agentDepth,
      title, summary, repository, cwd, branch, ${status} status,
    started_at startedAt, ended_at endedAt, updated_at updatedAt, input_tokens inputTokens, output_tokens outputTokens,
    cached_tokens cachedTokens, model, estimated_cost_usd estimatedCostUsd FROM sessions
    WHERE status = 'running' AND updated_at >= ? ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(staleCutoff(), staleCutoff(), limit) as SessionListItem[];
}

export function getAttentionSessions(limit = 8): SessionListItem[] {
  const status = statusExpression("status", "updated_at");
  const threeDayStart = new Date();
  threeDayStart.setHours(0, 0, 0, 0);
  threeDayStart.setDate(threeDayStart.getDate() - 2);
  return sqlite
    .prepare(
      `SELECT id, external_id externalId, provider, parent_external_id parentExternalId,
      session_kind sessionKind, agent_label agentLabel, agent_depth agentDepth,
      title, summary, repository, cwd, branch, ${status} status,
    started_at startedAt, ended_at endedAt, updated_at updatedAt, input_tokens inputTokens, output_tokens outputTokens,
    cached_tokens cachedTokens, model, estimated_cost_usd estimatedCostUsd FROM sessions
    WHERE ${status} IN ('interrupted', 'needs_attention') AND updated_at >= ?
    ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(
      staleCutoff(),
      staleCutoff(),
      threeDayStart.toISOString(),
      limit,
    ) as SessionListItem[];
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

/**
 * Bulk read-time cost for a set of sessions, following the same
 * pricing-trust rule as getSessionUsage: a session maps to a dollar figure
 * only when every one of its usage rows is priced, and to null otherwise.
 * Sessions without usage rows are absent from the map.
 */
export function getSessionsCostUsd(
  sessionIds: number[],
): Map<number, number | null> {
  if (!sessionIds.length) return new Map();
  const rows = sqlite
    .prepare(
      `${USAGE_JOIN} WHERE u.session_id IN (${sessionIds.map(() => "?").join(", ")})`,
    )
    .all(...sessionIds) as UsageJoinRow[];
  const totals = new Map<number, number | null>();
  for (const row of rows) {
    const cost = rowCost(row);
    const current = totals.get(row.sessionId);
    if (cost === undefined || current === null) totals.set(row.sessionId, null);
    else totals.set(row.sessionId, (current ?? 0) + cost);
  }
  return totals;
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

const PATTERNS_HEATMAP_DAYS = 30;
const PATTERNS_HEATMAP_TIME_ZONE = "America/New_York";
// en-CA renders dates as YYYY-MM-DD, which doubles as a stable sort key.
const patternsHeatmapFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: PATTERNS_HEATMAP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function patternsHeatmapDay(startedAt: string): string {
  return patternsHeatmapFormatter.format(new Date(startedAt));
}

const LENGTH_BUCKETS = [
  { label: "< 2 min", min: 0, max: 2 * 60_000 },
  { label: "2–10 min", min: 2 * 60_000, max: 10 * 60_000 },
  { label: "10–30 min", min: 10 * 60_000, max: 30 * 60_000 },
  { label: "30 min–1h", min: 30 * 60_000, max: 60 * 60_000 },
  // The top bucket is open-ended so long-running sessions (> 2h) still count.
  { label: "1h+", min: 60 * 60_000, max: Infinity },
] as const;

/**
 * Derives the three overview "pattern" views from existing session and
 * usage tables. The heatmap counts session starts per calendar day over the
 * actual trailing 30 days in America/New_York time; the length
 * histogram buckets the runtime expression over the trailing 7 days; the week
 * cost reuses the pricing-trust rule (null when any usage row is unpriced).
 */
export function getOverviewPatterns(): OverviewPatterns {
  // --- heatmap: session-start counts per calendar day over the last 30 days ---
  // Fetch one extra day so timezone offsets never clip the oldest cell, then
  // keep only starts that fall on one of the 30 tracked local dates.
  const heatStart = new Date(
    Date.now() - (PATTERNS_HEATMAP_DAYS + 1) * DAY_MS,
  ).toISOString();
  const heatRows = sqlite
    .prepare(
      `SELECT started_at startedAt
       FROM sessions WHERE started_at >= ?`,
    )
    .all(heatStart) as { startedAt: string }[];
  const heatDays = Array.from({ length: PATTERNS_HEATMAP_DAYS }, (_, index) =>
    patternsHeatmapDay(
      new Date(
        Date.now() - (PATTERNS_HEATMAP_DAYS - 1 - index) * DAY_MS,
      ).toISOString(),
    ),
  );
  const heatMap = new Map<string, number>(heatDays.map((day) => [day, 0]));
  for (const row of heatRows) {
    const day = patternsHeatmapDay(row.startedAt);
    const count = heatMap.get(day);
    if (count !== undefined) heatMap.set(day, count + 1);
  }
  const heatmap = heatDays.map((day) => ({
    day,
    count: heatMap.get(day) ?? 0,
  }));

  // --- length histogram: bucket runtime over 7 days ---
  const lengthStart = new Date(Date.now() - 7 * DAY_MS).toISOString();
  const lengthRows = sqlite
    .prepare(
      `SELECT
        CAST((julianday(COALESCE(ended_at, updated_at)) - julianday(started_at)) * 86400000 AS INTEGER) AS runtimeMs
       FROM sessions
       WHERE started_at >= ? AND started_at <= ?`,
    )
    .all(lengthStart, new Date().toISOString()) as { runtimeMs: number }[];
  const runtimes = lengthRows.map((row) => row.runtimeMs).sort((a, b) => a - b);
  const buckets = LENGTH_BUCKETS.map((bucket) => ({
    label: bucket.label,
    count: runtimes.filter((ms) => ms >= bucket.min && ms < bucket.max).length,
  }));
  const medianMs =
    runtimes.length > 0 ? runtimes[Math.floor(runtimes.length / 2)] : null;
  const longestMs = runtimes.length > 0 ? (runtimes.at(-1) ?? null) : null;
  const longRuntimeMs = runtimes
    .filter((ms) => ms >= 30 * 60_000)
    .reduce((sum, ms) => sum + ms, 0);
  const totalRuntimeMs = runtimes.reduce((sum, ms) => sum + ms, 0);
  const longTailShare =
    totalRuntimeMs > 0 ? longRuntimeMs / totalRuntimeMs : null;

  // --- week cost: reuse pricing-trust rule over 7-day window ---
  const weekStart = new Date(Date.now() - 7 * DAY_MS).toISOString();
  const usageRows = sqlite
    .prepare(`${USAGE_JOIN} WHERE s.started_at >= ?`)
    .all(weekStart) as UsageJoinRow[];
  let costUsd = 0;
  let tokens = 0;
  let priced = true;
  const byModel = new Map<string, { costUsd: number; priced: boolean }>();
  for (const row of usageRows) {
    const rowTokens =
      row.inputTokens +
      row.outputTokens +
      row.cacheReadTokens +
      row.cacheWriteTokens;
    tokens += rowTokens;
    const cost = rowCost(row);
    const modelKey = normalizeModel(row.model);
    const model = byModel.get(modelKey) ?? { costUsd: 0, priced: true };
    if (cost === undefined) {
      priced = false;
      model.priced = false;
    } else {
      costUsd += cost;
      model.costUsd += cost;
    }
    byModel.set(modelKey, model);
  }
  const topModels = [...byModel.entries()]
    .map(([model, totals]) => ({
      model,
      costUsd: totals.priced ? totals.costUsd : 0,
    }))
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 3);

  return {
    heatmap,
    length: {
      buckets,
      medianMs,
      longestMs,
      longTailShare,
      sessionCount: runtimes.length,
    },
    costWeek: {
      costUsd: priced ? costUsd : null,
      tokens,
      topModels,
    },
  };
}

const INSIGHTS_TREND_DAYS = 30;
// Hit-rate drop (percentage points) that fires a warning signal.
const CACHE_DROP_THRESHOLD_PTS = 15;

export type InsightSignal = {
  tone: "warning" | "info";
  text: string;
};

export interface Insights {
  cache: {
    week: {
      hitRate: number | null;
      hitRateDeltaPts: number | null;
      savedUsd: number | null;
      savedSharePct: number | null;
      byModel: { model: string; hitRate: number; tokens: number }[];
    };
    trend: { day: string; hitRate: number | null }[];
    signal: InsightSignal | null;
  };
  cost: {
    week: {
      totalUsd: number | null;
      top5SharePct: number | null;
      paretoSharePct: number | null;
    };
    outliers: {
      id: number;
      title: string;
      model: string | null;
      costUsd: number;
      runtimeMs: number;
      usdPerMin: number;
    }[];
    trend: { day: string; costUsd: number | null }[];
    signal: InsightSignal | null;
  };
}

// Aggregate cache hit-rate and $-saved over a window of usage rows.
// hitRate = sum(cacheRead) / sum(cacheRead + input). savedUsd requires every
// row priced: it is the gap between actual cost and the counterfactual where
// cache_read_tokens are re-priced at the full input rate.
function aggregateCache(rows: UsageJoinRow[]) {
  let read = 0;
  let input = 0;
  let grossCost = 0; // actual cost (cache reads at cache-read rate)
  let counterfactual = 0; // if cache reads were priced as full input
  let priced = true;
  const byModel = new Map<
    string,
    { read: number; input: number; tokens: number }
  >();
  for (const row of rows) {
    read += row.cacheReadTokens;
    input += row.inputTokens;
    const cost = rowCost(row);
    if (cost === undefined) {
      priced = false;
    } else {
      const pricing = findPricing(row.model, row.startedAt);
      // $ saved only meaningful when we can price both the actual read rate
      // and the counterfactual input rate. rowCost can be defined from a
      // provider-reported cost alone (reported wins even with no pricing
      // entry), so it does NOT guarantee pricing exists. With a pricing entry
      // we can build the counterfactual; a reported-cost row with no pricing
      // entry cannot, so it is treated as unpriced for $-saved purposes.
      if (pricing) {
        grossCost += cost;
        counterfactual +=
          cost +
          (row.cacheReadTokens *
            (pricing.inputPerMTok - pricing.cacheReadPerMTok)) /
            1_000_000;
      } else if (row.reportedCostUsd !== null) {
        // Reported cost with no pricing table entry: can't build a
        // counterfactual, so treat as unpriced for $-saved purposes.
        priced = false;
      }
    }
    const key = normalizeModel(row.model);
    const model = byModel.get(key) ?? { read: 0, input: 0, tokens: 0 };
    model.read += row.cacheReadTokens;
    model.input += row.inputTokens;
    model.tokens +=
      row.inputTokens +
      row.outputTokens +
      row.cacheReadTokens +
      row.cacheWriteTokens;
    byModel.set(key, model);
  }
  const hitRate = read + input > 0 ? read / (read + input) : null;
  const savedUsd =
    priced && counterfactual > grossCost ? counterfactual - grossCost : null;
  const savedSharePct =
    savedUsd !== null && counterfactual > 0
      ? (savedUsd / counterfactual) * 100
      : null;
  const byModelOut = [...byModel.entries()]
    .map(([model, m]) => ({
      model,
      hitRate: m.read + m.input > 0 ? m.read / (m.read + m.input) : 0,
      tokens: m.tokens,
    }))
    .sort((a, b) => b.tokens - a.tokens);
  // NOTE: happy-path $-saved has no regression test because the shared fixture's
  // unpriced s4 forces null across the week window (pricing-trust rule).
  return { hitRate, savedUsd, savedSharePct, byModel: byModelOut, read, input };
}

/**
 * Two actionable efficiency cards derived from existing usage data.
 * Cache hit rate is token-only and always available; $-saved and all cost
 * figures follow the pricing-trust rule (null when any row is unpriced).
 * Signals are curated and rule-based.
 */
export function getInsights(): Insights {
  const weekStart = new Date(Date.now() - 7 * DAY_MS).toISOString();
  const priorWeekStart = new Date(Date.now() - 14 * DAY_MS).toISOString();
  const trendStart = new Date(
    Date.now() - INSIGHTS_TREND_DAYS * DAY_MS,
  ).toISOString();

  const weekRows = sqlite
    .prepare(`${USAGE_JOIN} WHERE s.started_at >= ?`)
    .all(weekStart) as UsageJoinRow[];
  const priorRows = sqlite
    .prepare(`${USAGE_JOIN} WHERE s.started_at >= ? AND s.started_at < ?`)
    .all(priorWeekStart, weekStart) as UsageJoinRow[];
  const trendRows = sqlite
    .prepare(`${USAGE_JOIN} WHERE s.started_at >= ?`)
    .all(trendStart) as UsageJoinRow[];

  // --- cost outliers: per-session cost + runtime over the week window ---
  interface CostRow {
    id: number;
    title: string;
    model: string | null;
    provider: AgentProvider;
    startedAt: string;
    runtimeMs: number;
  }
  const costSessionRows = sqlite
    .prepare(
      `SELECT s.id, s.title, s.model, s.provider, s.started_at startedAt,
        CAST((julianday(COALESCE(s.ended_at, s.updated_at)) - julianday(s.started_at)) * 86400000 AS INTEGER) AS runtimeMs
       FROM sessions s WHERE s.started_at >= ?`,
    )
    .all(weekStart) as CostRow[];

  // --- cache effectiveness ---
  const weekCache = aggregateCache(weekRows);
  const priorCache = aggregateCache(priorRows);
  const hitRateDeltaPts =
    weekCache.hitRate !== null && priorCache.hitRate !== null
      ? (weekCache.hitRate - priorCache.hitRate) * 100
      : null;
  const cacheSignal: InsightSignal | null =
    hitRateDeltaPts !== null && hitRateDeltaPts <= -CACHE_DROP_THRESHOLD_PTS
      ? {
          tone: "warning",
          text: `Cache hit rate dropped ${Math.round(Math.abs(hitRateDeltaPts))} points week-over-week — long sessions may be losing context.`,
        }
      : null;

  // 30-day daily hit-rate trend, grouped by session start day.
  const trendByDay = new Map<string, { read: number; input: number }>();
  for (const row of trendRows) {
    const day = row.startedAt.slice(0, 10);
    const entry = trendByDay.get(day) ?? { read: 0, input: 0 };
    entry.read += row.cacheReadTokens;
    entry.input += row.inputTokens;
    trendByDay.set(day, entry);
  }
  const cacheTrend = Array.from({ length: INSIGHTS_TREND_DAYS }, (_, index) => {
    const date = new Date(
      Date.now() - (INSIGHTS_TREND_DAYS - 1 - index) * DAY_MS,
    )
      .toISOString()
      .slice(0, 10);
    const entry = trendByDay.get(date);
    return {
      day: date,
      hitRate:
        entry && entry.read + entry.input > 0
          ? entry.read / (entry.read + entry.input)
          : null,
    };
  });

  // --- cost outliers ---
  // Per-session usage cost over the week, keyed by session id. A session's
  // cost is the sum of its priced usage rows; unpriced rows contribute nothing
  // to that session's cost. runtimeMs comes from costSessionRows.
  const sessionCost = new Map<number, number>();
  let weekTotalUsd: number | null = 0;
  let anyUnpriced = false;
  for (const row of weekRows) {
    const cost = rowCost(row);
    if (cost === undefined) {
      anyUnpriced = true;
      continue;
    }
    weekTotalUsd += cost; // accumulate the priced grand total
    sessionCost.set(
      row.sessionId,
      (sessionCost.get(row.sessionId) ?? 0) + cost,
    );
  }
  if (anyUnpriced) weekTotalUsd = null; // trust rule: null when any row unpriced

  // Outliers: top 5 by session cost. usdPerMin excludes zero/negative runtime.
  const runtimeById = new Map(
    costSessionRows.map((r) => [r.id, { row: r, runtimeMs: r.runtimeMs }]),
  );
  const outliers = [...sessionCost.entries()]
    .map(([id, costUsd]) => {
      const meta = runtimeById.get(id);
      const runtimeMs = meta?.runtimeMs ?? 0;
      const minutes = Math.max(runtimeMs / 60_000, 1);
      return {
        id,
        title: meta?.row.title ?? "Untitled",
        model: meta?.row.model ?? null,
        costUsd,
        runtimeMs,
        usdPerMin: costUsd / minutes,
      };
    })
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 5);

  // Pareto: share of week cost held by the top 3 sessions. Null when the
  // week total is unpriced (trust rule) or there is no priced spend.
  const top3Cost = outliers.slice(0, 3).reduce((sum, o) => sum + o.costUsd, 0);
  let paretoSharePct: number | null = null;
  if (weekTotalUsd !== null && weekTotalUsd > 0) {
    paretoSharePct = (top3Cost / weekTotalUsd) * 100;
  }
  // Top-5 headline share: share of week cost held by the top 5 sessions (a
  // distinct figure from the top-3 signal threshold above). Null under the
  // same trust rule.
  const top5Cost = outliers.slice(0, 5).reduce((sum, o) => sum + o.costUsd, 0);
  const top5SharePct =
    weekTotalUsd !== null && weekTotalUsd > 0
      ? (top5Cost / weekTotalUsd) * 100
      : null;
  const costSignal: InsightSignal | null =
    paretoSharePct !== null && paretoSharePct >= 50
      ? {
          tone: "warning",
          text: `Three sessions drove ${Math.round(paretoSharePct)}% of this week's cost — inspect them for loops or retries.`,
        }
      : null;

  // Cost trend reuses the existing getUsageSummary daily series rather than
  // recomputing it (keeps a single source of truth for daily cost).
  // Priced-only daily series (matches /usage); a partially-unpriced week still
  // shows a populated trend alongside a null headline total.
  const costTrend = getUsageSummary().daily.map((d) => ({
    day: d.date,
    costUsd: d.costUsd,
  }));

  return {
    cache: {
      week: {
        hitRate: weekCache.hitRate,
        hitRateDeltaPts,
        savedUsd: weekCache.savedUsd,
        savedSharePct: weekCache.savedSharePct,
        byModel: weekCache.byModel,
      },
      trend: cacheTrend,
      signal: cacheSignal,
    },
    cost: {
      week: { totalUsd: weekTotalUsd, top5SharePct, paretoSharePct },
      outliers,
      trend: costTrend,
      signal: costSignal,
    },
  };
}
