import { sqlite } from "@/db/client";
import { canonicalCapabilityName } from "./agent-inventory/normalize";
import type { AgentInventory } from "./agent-inventory/types";
import { findPricing, normalizeModel, usageCostUsd } from "./pricing";
import { findGitRoot, resolveProjectGitHubUrl } from "./project-github";
import {
  agentProviders,
  UNKNOWN_PROJECT_KEY,
  UNKNOWN_MODEL_KEY,
  TASKS_PROJECT_KEY,
  type AgentProvider,
  type CostSource,
  type SessionStatus,
  type StatusReason,
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
  statusReason: StatusReason | null;
  startedAt: string;
  endedAt: string | null;
  updatedAt: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  model: string | null;
  estimatedCostUsd: number | null;
  /**
   * Read-time derived cost (pricing-trust rule); absent when not computed.
   * Rolled up over the session's subagent subtree — see getSessionsCostUsd.
   */
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
  project?: string;
  /** Canonical model id (normalizeModel output) or UNKNOWN_MODEL_KEY. */
  model?: string;
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
    node.children.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return roots;
}

function sessionRuntimeMs(session: SessionListItem): number {
  return (
    new Date(session.endedAt ?? session.updatedAt).getTime() -
    new Date(session.startedAt).getTime()
  );
}

function getSessionsMatchingFilters(
  filters: SessionFilters,
  limit: number | null,
  includeSubtreeCosts = true,
): SessionTreeItem[] {
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
      clauses.push(`${status} IN ('interrupted', 'needs_attention', 'failed')`);
      params.push(staleCutoff());
    } else {
      clauses.push(`${status} = ?`);
      params.push(staleCutoff(), filters.status);
    }
  }
  if (filters.project && filters.project !== "all") {
    // Sessions with no repository share the "(unknown)" project key.
    if (filters.project === UNKNOWN_PROJECT_KEY) {
      clauses.push("repository IS NULL");
    } else {
      clauses.push("repository = ?");
      params.push(filters.project);
    }
  }
  if (filters.model && filters.model !== "all") {
    if (filters.model === UNKNOWN_MODEL_KEY) {
      clauses.push("(model IS NULL OR model = '')");
    } else {
      // normalizeModel can't run inside SQLite, so resolve the selected
      // canonical id back to the raw model strings that normalize to it and
      // match those. An empty set (id no longer present) matches nothing.
      const raws = distinctRawModels().filter(
        (raw) => normalizeModel(raw) === filters.model,
      );
      if (raws.length) {
        clauses.push(`model IN (${raws.map(() => "?").join(", ")})`);
        params.push(...raws);
      } else {
        clauses.push("1 = 0");
      }
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
      title, summary, repository, cwd, branch, ${status} status, status_reason statusReason,
    started_at startedAt, ended_at endedAt, updated_at updatedAt, input_tokens inputTokens, output_tokens outputTokens,
    cached_tokens cachedTokens, model, estimated_cost_usd estimatedCostUsd FROM sessions ${where} ORDER BY updated_at DESC${limit === null ? "" : " LIMIT ?"}`,
    )
    .all(
      staleCutoff(),
      ...params,
      ...(limit === null ? [] : [limit]),
    ) as SessionListItem[];
  if (includeSubtreeCosts) {
    const costs = getSessionsCostUsd(sessions.map((session) => session.id));
    for (const session of sessions)
      session.costUsd = costs.get(session.id) ?? null;
  }
  const roots = nestSessions(sessions);
  if (filters.sort === "started")
    roots.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  else if (filters.sort === "duration")
    roots.sort((a, b) => sessionRuntimeMs(b) - sessionRuntimeMs(a));
  else if (filters.sort === "cost")
    roots.sort((a, b) => (b.costUsd ?? -1) - (a.costUsd ?? -1));
  else roots.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return roots;
}

export function getSessions(filters: SessionFilters): SessionTreeItem[] {
  return getSessionsMatchingFilters(filters, 250);
}

export interface ProjectOption {
  key: string;
  label: string;
  sessionCount: number;
}

/**
 * Git-backed repositories for the "Filter by project" control. Reuses the same
 * project/task categorization as the Projects rollup so the dropdown lists only
 * real repositories and stays consistent with that view. Kept independent of
 * the active filters so selecting one project never narrows the list to that
 * single option, and ordered by most recent activity.
 */
export function getProjectOptions(): ProjectOption[] {
  return getProjects()
    .filter((project) => project.category === "project" && project.repository)
    .map((project) => ({
      key: project.key,
      label: project.repository as string,
      sessionCount: project.sessionCount,
    }));
}

export interface ModelOption {
  value: string;
  label: string;
  sessionCount: number;
}

/** Distinct non-normalized model strings recorded across all sessions. */
function distinctRawModels(): string[] {
  return (
    sqlite
      .prepare(
        "SELECT DISTINCT model FROM sessions WHERE model IS NOT NULL AND model != ''",
      )
      .all() as { model: string }[]
  ).map((row) => row.model);
}

/**
 * Canonical models for the "Filter by model" control. Raw provider strings are
 * collapsed with normalizeModel so snapshot/prefix variants share one option,
 * matching how the Insights page groups models. Sessions with no recorded model
 * roll up under UNKNOWN_MODEL_KEY. Kept independent of the active filters so
 * selecting a model never narrows the list, and ordered by session count.
 */
export function getModelOptions(): ModelOption[] {
  const rows = sqlite
    .prepare("SELECT model, COUNT(*) count FROM sessions GROUP BY model")
    .all() as { model: string | null; count: number }[];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.model ? normalizeModel(row.model) : UNKNOWN_MODEL_KEY;
    counts.set(key, (counts.get(key) ?? 0) + row.count);
  }
  return [...counts.entries()]
    .map(([value, sessionCount]) => ({ value, label: value, sessionCount }))
    .sort(
      (a, b) =>
        b.sessionCount - a.sessionCount || a.label.localeCompare(b.label),
    );
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
        ${status} status, status_reason statusReason, started_at startedAt, ended_at endedAt, updated_at updatedAt, input_tokens inputTokens,
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
       title, summary, repository, cwd, branch, ${status} status, status_reason statusReason,
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
         title, summary, repository, cwd, branch, ${status} status, status_reason statusReason,
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
  githubUrl: string | null;
  category: "project" | "task";
  sessionCount: number;
  activeCount: number;
  providers: AgentProvider[];
  branches: string[];
  workdirs: string[];
  totalRuntimeMs: number;
  lastActivityAt: string;
}

export interface ProjectCostSummary extends ProjectSummary {
  /** Spend from fully priced top-level session trees in the active filters. */
  totalCostUsd: number | null;
  /** Top-level session trees omitted because at least one usage row is unpriced. */
  unpricedSessionCount: number;
}

export type ProjectState = "active" | "waiting" | "blocked" | "complete";

/**
 * One session's most recent retained lifecycle event. Provider activity titles
 * are generic ("Task completed"), so the session a run belongs to is the only
 * part that identifies the work; the feed is keyed by session for that reason.
 */
export interface ProjectActivity {
  kind: "started" | "file" | "command" | "completed";
  sessionId: number;
  sessionTitle: string | null;
  provider: AgentProvider;
  status: SessionStatus;
  occurredAt: string;
}

export interface ProjectProviderSplit {
  provider: AgentProvider;
  sessionCount: number;
  /** Spend over this provider's fully-priced sessions in the window. */
  costUsd: number;
  unpricedSessionCount: number;
}

export interface ProjectWorktree {
  workdir: string;
  branches: string[];
  sessionCount: number;
  lastActivityAt: string;
}

/** Which evidence sessions the briefing lists. URL-backed, like `range`. */
export type ProjectEvidenceFilter = "all" | "attention";

/**
 * First value of a Next.js search param, which arrives as a string or a
 * string[] depending on how the URL was built. Shared by every page-level
 * filter parser.
 */
export function firstParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseProjectEvidenceFilter(
  value: unknown,
): ProjectEvidenceFilter {
  return value === "attention" ? "attention" : "all";
}

/**
 * The briefing data for one safely-grouped project. A project exists only
 * when Relay observed a repository together with branch or local Git evidence;
 * titles and activity remain provider-derived evidence rather than task plans.
 *
 * Every `window*` field, the cost roll-up, the trend, and the provider split
 * describe `range` only; `project` stays the all-time summary so the briefing
 * header matches the card the user clicked through from.
 */
export interface ProjectDetail {
  project: ProjectSummary;
  range: OverviewRange;
  evidenceFilter: ProjectEvidenceFilter;
  /** Sessions touched in `range`, counted once each (subagents included). */
  windowSessionCount: number;
  windowRuntimeMs: number;
  state: ProjectState;
  currentFocus: SessionListItem | null;
  attention: SessionListItem[];
  sessions: SessionListItem[];
  /** True when `sessions` was truncated by the evidence cap. */
  sessionsTruncated: boolean;
  activity: ProjectActivity[];
  /**
   * Spend over fully-priced sessions in the window, following the usage page's
   * rule: a session with any unpriced usage row is excluded from dollar sums
   * rather than nulling the whole rollup, and counted in
   * `unpricedSessionCount` so the exclusion stays visible.
   */
  totalCostUsd: number;
  unpricedSessionCount: number;
  /** Daily spend across `range`, oldest first, with empty days filled in. */
  costTrend: { date: string; costUsd: number }[];
  largestCostSessions: SessionListItem[];
  largestCostSession: SessionListItem | null;
  byProvider: ProjectProviderSplit[];
  worktrees: ProjectWorktree[];
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
  return (row.workdirs?.split(",") ?? []).some((cwd) => findGitRoot(cwd));
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

function flattenSessionTrees(sessions: SessionTreeItem[]): SessionListItem[] {
  const flattened: SessionListItem[] = [];
  const visit = (session: SessionTreeItem) => {
    flattened.push(session);
    for (const child of session.children) visit(child);
  };
  for (const session of sessions) visit(session);
  return flattened;
}

function summarizeProjects(rows: ProjectRow[]): ProjectSummary[] {
  const summaries: ProjectSummary[] = rows.map((row) => {
    const workdirs = row.workdirs?.split(",") ?? [];
    return {
      key: row.repository ?? UNKNOWN_PROJECT_KEY,
      repository: row.repository,
      githubUrl: resolveProjectGitHubUrl(workdirs),
      category: isRepositoryBacked(row) ? "project" : "task",
      sessionCount: row.sessionCount,
      activeCount: row.activeCount,
      providers: (row.providers?.split(",") ?? []) as AgentProvider[],
      branches: row.branches?.split(",") ?? [],
      workdirs,
      totalRuntimeMs: row.totalRuntimeMs,
      lastActivityAt: row.lastActivityAt,
    };
  });
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
      githubUrl: null,
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

export function getProjectsWithCosts(
  filters: SessionFilters,
): ProjectCostSummary[] {
  const sessions = getSessionsMatchingFilters(filters, null, false);
  const projectSessions = flattenSessionTrees(sessions);
  const projects = projectsFromSessions(projectSessions);
  const projectKeys = new Set(
    projects
      .filter((project) => project.category === "project")
      .map((project) => project.key),
  );
  const costs = getOwnSessionCostsUsd(
    projectSessions.map((session) => session.id),
  );
  const totals = new Map<
    string,
    {
      costUsd: number;
      pricedSessionCount: number;
      unpricedSessionCount: number;
    }
  >();

  for (const session of projectSessions) {
    const key =
      session.repository && projectKeys.has(session.repository)
        ? session.repository
        : TASKS_PROJECT_KEY;
    const total = totals.get(key) ?? {
      costUsd: 0,
      pricedSessionCount: 0,
      unpricedSessionCount: 0,
    };
    const cost = costs.get(session.id);
    if (cost === null) total.unpricedSessionCount += 1;
    else if (cost !== undefined) {
      total.costUsd += cost;
      total.pricedSessionCount += 1;
    }
    totals.set(key, total);
  }

  return projects.map((project) => {
    const total = totals.get(project.key);
    return {
      ...project,
      totalCostUsd: total?.pricedSessionCount ? total.costUsd : null,
      unpricedSessionCount: total?.unpricedSessionCount ?? 0,
    };
  });
}

/** Evidence list cap. Kept small enough to stay a scannable list, not a table. */
const PROJECT_EVIDENCE_LIMIT = 50;

export function getProjectSessions(
  key: string,
  options: { since?: string; limit?: number } = {},
): SessionListItem[] {
  const status = statusExpression("status", "updated_at");
  const repositoryKeys = getProjects()
    .filter((project) => project.category === "project")
    .map((project) => project.key);
  const isTasks = key === TASKS_PROJECT_KEY || key === UNKNOWN_PROJECT_KEY;
  const scope = isTasks
    ? repositoryKeys.length
      ? `(repository IS NULL OR repository NOT IN (${repositoryKeys.map(() => "?").join(", ")}))`
      : "1 = 1"
    : "repository = ?";
  const where = options.since ? `${scope} AND updated_at >= ?` : scope;
  const params: unknown[] = [
    staleCutoff(),
    ...(isTasks ? repositoryKeys : [key]),
    ...(options.since ? [options.since] : []),
  ];
  const limit = options.limit ?? PROJECT_EVIDENCE_LIMIT;
  return sqlite
    .prepare(
      `SELECT id, external_id externalId, provider, parent_external_id parentExternalId,
      session_kind sessionKind, agent_label agentLabel, agent_depth agentDepth,
      title, summary, repository, cwd, branch, ${status} status, status_reason statusReason,
    started_at startedAt, ended_at endedAt, updated_at updatedAt, input_tokens inputTokens, output_tokens outputTokens,
    cached_tokens cachedTokens, model, estimated_cost_usd estimatedCostUsd FROM sessions WHERE ${where}
    ORDER BY started_at DESC LIMIT ?`,
    )
    .all(...params, limit) as SessionListItem[];
}

function projectState(sessions: SessionListItem[]): ProjectState {
  if (sessions.some((session) => session.status === "running")) return "active";
  if (sessions.some((session) => session.status === "needs_attention")) {
    return "waiting";
  }
  if (
    sessions.some(
      (session) =>
        session.status === "failed" || session.status === "interrupted",
    )
  ) {
    return "blocked";
  }
  return "complete";
}

const ATTENTION_STATUSES: SessionStatus[] = [
  "needs_attention",
  "failed",
  "interrupted",
];

interface ProjectUsageRow extends UsageJoinRow {
  updatedAt: string;
}

/**
 * Every usage row for a project's in-window sessions, each session visited
 * exactly once. Aggregates must build on this rather than on the subtree
 * roll-ups from `getSessionsCostUsd`, which would count a delegating parent
 * and its subagents twice over.
 */
function projectUsageRows(key: string, since?: string): ProjectUsageRow[] {
  const where = since
    ? "WHERE s.repository = ? AND s.updated_at >= ?"
    : "WHERE s.repository = ?";
  return sqlite
    .prepare(
      `SELECT u.session_id sessionId, s.provider, s.repository, s.started_at startedAt,
        s.updated_at updatedAt, u.model, u.input_tokens inputTokens,
        u.output_tokens outputTokens, u.cache_read_tokens cacheReadTokens,
        u.cache_write_tokens cacheWriteTokens, u.reported_cost_usd reportedCostUsd
      FROM session_model_usage u JOIN sessions s ON s.id = u.session_id
      ${where}`,
    )
    .all(...(since ? [key, since] : [key])) as ProjectUsageRow[];
}

/**
 * Oldest-first list of ISO dates ending today, so a 7d range represents today
 * plus the previous six calendar days. UTC throughout, matching the
 * `slice(0, 10)` the trend buckets on.
 */
function dateSpan(days: number, firstDate?: string | null): string[] {
  const end = Date.parse(
    `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`,
  );
  const start = firstDate
    ? Date.parse(`${firstDate.slice(0, 10)}T00:00:00.000Z`)
    : end - (days - 1) * DAY_MS;
  const length = Math.max(1, Math.floor((end - start) / DAY_MS) + 1);
  return Array.from({ length }, (_, index) =>
    new Date(start + index * DAY_MS).toISOString().slice(0, 10),
  );
}

/**
 * Ranks the project's costliest work by crediting each subtree to its topmost
 * in-window session, mirroring the insights outlier rule: a subagent is only
 * ranked on its own when the run that spawned it fell outside the window.
 */
function largestCostSessions(
  key: string,
  since?: string,
  limit = 5,
): SessionListItem[] {
  const windowSessions = getProjectSessions(key, { since, limit: -1 });
  const inWindow = new Set(
    windowSessions.map(
      (session) => `${session.provider}:${session.externalId}`,
    ),
  );
  const topmost = windowSessions.filter(
    (session) =>
      !session.parentExternalId ||
      !inWindow.has(`${session.provider}:${session.parentExternalId}`),
  );
  const costs = getSessionsCostUsd(topmost.map((session) => session.id));
  return topmost
    .flatMap((session) => {
      const costUsd = costs.get(session.id);
      return costUsd == null ? [] : [{ ...session, costUsd }];
    })
    .sort(
      (a, b) =>
        (b.costUsd ?? 0) - (a.costUsd ?? 0) ||
        b.updatedAt.localeCompare(a.updatedAt),
    )
    .slice(0, limit);
}

export function getProjectDetail(
  key: string,
  range: OverviewRange = "7d",
  evidenceFilter: ProjectEvidenceFilter = "all",
): ProjectDetail | null {
  const project = getProjects().find(
    (candidate) => candidate.category === "project" && candidate.key === key,
  );
  if (!project) return null;
  const days = overviewRangeDays(range);
  const since = overviewRangeStart(range);

  const sessions = getProjectSessions(key, {
    since: since ?? undefined,
    limit: PROJECT_EVIDENCE_LIMIT + 1,
  });
  const sessionsTruncated = sessions.length > PROJECT_EVIDENCE_LIMIT;
  if (sessionsTruncated) sessions.length = PROJECT_EVIDENCE_LIMIT;
  const costs = getSessionsCostUsd(sessions.map((session) => session.id));
  for (const session of sessions)
    session.costUsd = costs.get(session.id) ?? null;

  const windowWhere = since
    ? "WHERE repository = ? AND updated_at >= ?"
    : "WHERE repository = ?";
  const window = sqlite
    .prepare(
      `SELECT COUNT(*) sessionCount,
        COALESCE(SUM((julianday(COALESCE(ended_at, updated_at)) - julianday(started_at)) * 86400000), 0) runtimeMs,
        MIN(updated_at) firstAt
      FROM sessions ${windowWhere}`,
    )
    .get(...(since ? [key, since] : [key])) as {
    sessionCount: number;
    runtimeMs: number;
    firstAt: string | null;
  };

  // Accumulate per session first: pricing trust is a per-session property, so
  // a session with one unpriced row must drop out of the dollar sums whole
  // rather than contributing its priced rows.
  interface CostAccumulator {
    provider: AgentProvider;
    date: string;
    costUsd: number;
    priced: boolean;
  }
  const bySession = new Map<number, CostAccumulator>();
  for (const row of projectUsageRows(key, since ?? undefined)) {
    const entry = bySession.get(row.sessionId) ?? {
      provider: row.provider,
      date: row.updatedAt.slice(0, 10),
      costUsd: 0,
      priced: true,
    };
    const cost = rowCost(row);
    if (cost === undefined) entry.priced = false;
    else entry.costUsd += cost;
    bySession.set(row.sessionId, entry);
  }

  let totalCostUsd = 0;
  let unpricedSessionCount = 0;
  const byDate = new Map<string, number>();
  const providerCost = new Map<
    AgentProvider,
    { costUsd: number; unpricedSessionCount: number }
  >();
  for (const entry of bySession.values()) {
    const provider = providerCost.get(entry.provider) ?? {
      costUsd: 0,
      unpricedSessionCount: 0,
    };
    if (entry.priced) {
      totalCostUsd += entry.costUsd;
      byDate.set(entry.date, (byDate.get(entry.date) ?? 0) + entry.costUsd);
      provider.costUsd += entry.costUsd;
    } else {
      unpricedSessionCount += 1;
      provider.unpricedSessionCount += 1;
    }
    providerCost.set(entry.provider, provider);
  }

  const providerCounts = sqlite
    .prepare(
      `SELECT provider, COUNT(*) sessionCount FROM sessions
       ${windowWhere}
       GROUP BY provider ORDER BY sessionCount DESC`,
    )
    .all(...(since ? [key, since] : [key])) as {
    provider: AgentProvider;
    sessionCount: number;
  }[];

  const worktrees = sqlite
    .prepare(
      `SELECT cwd workdir, GROUP_CONCAT(DISTINCT branch) branches,
        COUNT(*) sessionCount, MAX(updated_at) lastActivityAt
      FROM sessions WHERE repository = ? AND cwd IS NOT NULL
      GROUP BY cwd ORDER BY lastActivityAt DESC`,
    )
    .all(key) as (Omit<ProjectWorktree, "branches"> & {
    branches: string | null;
  })[];

  const attention = sessions
    .filter((session) => ATTENTION_STATUSES.includes(session.status))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const rankedCostSessions = largestCostSessions(key, since ?? undefined);

  return {
    project,
    range,
    evidenceFilter,
    windowSessionCount: window.sessionCount,
    windowRuntimeMs: window.runtimeMs,
    state: projectState(sessions),
    currentFocus: sessions[0] ?? null,
    attention,
    sessions: evidenceFilter === "attention" ? attention : sessions,
    sessionsTruncated:
      evidenceFilter === "attention" ? false : sessionsTruncated,
    activity: projectActivity(key, since ?? undefined),
    totalCostUsd,
    unpricedSessionCount,
    costTrend: dateSpan(days ?? 1, days === null ? window.firstAt : null).map(
      (date) => ({
        date,
        costUsd: byDate.get(date) ?? 0,
      }),
    ),
    largestCostSessions: rankedCostSessions,
    largestCostSession: rankedCostSessions[0] ?? null,
    byProvider: providerCounts.map((row) => ({
      provider: row.provider,
      sessionCount: row.sessionCount,
      costUsd: providerCost.get(row.provider)?.costUsd ?? 0,
      unpricedSessionCount:
        providerCost.get(row.provider)?.unpricedSessionCount ?? 0,
    })),
    worktrees: worktrees.map((row) => ({
      ...row,
      branches: (row.branches?.split(",") ?? []).filter(Boolean),
    })),
  };
}

/**
 * The most recent retained lifecycle event per session, newest first. Grouping
 * by session is what makes the feed readable: the raw events all share a
 * handful of generic titles, so ungrouped they read as noise.
 */
function projectActivity(key: string, since?: string): ProjectActivity[] {
  const status = statusExpression("s.status", "s.updated_at");
  const rangeClause = since ? "AND e.occurred_at >= ?" : "";
  return sqlite
    .prepare(
      `SELECT e.session_id sessionId, s.title sessionTitle, s.provider,
        ${status} status, e.kind, MAX(e.occurred_at) occurredAt
      FROM activity_events e JOIN sessions s ON s.id = e.session_id
      WHERE s.repository = ? ${rangeClause}
        AND e.kind IN ('started', 'file', 'command', 'completed')
      GROUP BY e.session_id
      ORDER BY occurredAt DESC LIMIT 5`,
    )
    .all(staleCutoff(), ...(since ? [key, since] : [key])) as ProjectActivity[];
}

export interface OverviewPatterns {
  heatmap: { day: string; band: number; count: number }[];
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
    /** Every priced model in the window, ranked by cost — never a top-N slice. */
    models: { model: string; costUsd: number }[];
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

// URL-backed overview range. 7d is the default and preserves the page's
// original "this week" behavior; 30d widens every time-windowed metric and
// all removes the lower date boundary.
export type OverviewRange = "7d" | "30d" | "all";

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfToday(): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.toISOString();
}

export function parseOverviewRange(value: unknown): OverviewRange {
  return value === "30d" || value === "all" ? value : "7d";
}

function overviewRangeDays(range: OverviewRange): 7 | 30 | null {
  return range === "7d" ? 7 : range === "30d" ? 30 : null;
}

function overviewRangeStart(range: OverviewRange): string | null {
  const days = overviewRangeDays(range);
  return days === null
    ? null
    : new Date(Date.now() - days * DAY_MS).toISOString();
}

export function getOverview(range: OverviewRange = "7d"): OverviewData {
  const todayStart = startOfToday();
  const weekStart = overviewRangeStart(range);
  const status = statusExpression("status", "updated_at");

  const windowStats = (since: string | null) =>
    sqlite
      .prepare(
        `SELECT COUNT(*) sessions,
          COALESCE(SUM((julianday(COALESCE(ended_at, updated_at)) - julianday(started_at)) * 86400000), 0) runtimeMs,
          COALESCE(SUM(CASE WHEN ${status} IN ('interrupted', 'needs_attention', 'failed') THEN 1 ELSE 0 END), 0) failures
        FROM sessions ${since ? "WHERE started_at >= ?" : ""}`,
      )
      .get(staleCutoff(), ...(since ? [since] : [])) as {
      sessions: number;
      runtimeMs: number;
      failures: number;
    };
  const events = (since: string | null) =>
    (
      sqlite
        .prepare(
          `SELECT COUNT(*) count FROM activity_events ${since ? "WHERE occurred_at >= ?" : ""}`,
        )
        .get(...(since ? [since] : [])) as { count: number }
    ).count;

  const today = windowStats(todayStart);
  const week = windowStats(weekStart);
  const providerCounts = sqlite
    .prepare(
      `SELECT provider, COUNT(*) count FROM sessions ${weekStart ? "WHERE started_at >= ?" : ""}
      GROUP BY provider ORDER BY count DESC`,
    )
    .all(...(weekStart ? [weekStart] : [])) as {
    provider: AgentProvider;
    count: number;
  }[];

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
      title, summary, repository, cwd, branch, ${status} status, status_reason statusReason,
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
      title, summary, repository, cwd, branch, ${status} status, status_reason statusReason,
    started_at startedAt, ended_at endedAt, updated_at updatedAt, input_tokens inputTokens, output_tokens outputTokens,
    cached_tokens cachedTokens, model, estimated_cost_usd estimatedCostUsd FROM sessions
    WHERE ${status} IN ('interrupted', 'needs_attention', 'failed') AND updated_at >= ?
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
 * Provider-scoped descendant expansion over `parent_external_id`, seeded from
 * a set of session ids and labelling every row with the seed it descends from.
 * UNION (not UNION ALL) both dedupes diamond paths and terminates on the
 * self-parent cycles a malformed rollout could produce.
 */
function subtreeUsageRows(sessionIds: number[]): (UsageJoinRow & {
  rootId: number;
})[] {
  const placeholders = sessionIds.map(() => "?").join(", ");
  return sqlite
    .prepare(
      `WITH RECURSIVE subtree(rootId, id, provider, externalId) AS (
        SELECT id, id, provider, external_id FROM sessions WHERE id IN (${placeholders})
        UNION
        SELECT t.rootId, s.id, s.provider, s.external_id
        FROM sessions s JOIN subtree t
          ON s.provider = t.provider AND s.parent_external_id = t.externalId
      )
      SELECT t.rootId rootId, u.session_id sessionId, s.provider, s.repository,
        s.started_at startedAt, u.model, u.input_tokens inputTokens,
        u.output_tokens outputTokens, u.cache_read_tokens cacheReadTokens,
        u.cache_write_tokens cacheWriteTokens, u.reported_cost_usd reportedCostUsd
      FROM subtree t
      JOIN sessions s ON s.id = t.id
      JOIN session_model_usage u ON u.session_id = t.id`,
    )
    .all(...sessionIds) as (UsageJoinRow & { rootId: number })[];
}

/**
 * Per-session cost without descendant roll-up. Aggregate views use this so
 * every stored session is counted once and pricing gaps remain scoped to the
 * session that contains them.
 */
function getOwnSessionCostsUsd(
  sessionIds: number[],
): Map<number, number | null> {
  if (!sessionIds.length) return new Map();
  const placeholders = sessionIds.map(() => "?").join(", ");
  const rows = sqlite
    .prepare(`${USAGE_JOIN} WHERE u.session_id IN (${placeholders})`)
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

/**
 * Bulk read-time cost for a set of sessions, rolled up over each session's
 * subagent subtree: a main session's figure is its own spend plus every
 * descendant subagent's, because delegated work is spend the parent caused.
 * The pricing-trust rule spans the subtree too — the roll-up is a dollar
 * figure only when every usage row in it is priced, and null otherwise.
 * Sessions with no priced-or-unpriced usage anywhere in their subtree are
 * absent from the map. Aggregate views (usage, insights) must keep visiting
 * sessions individually; rolling up there would double-count subagents.
 */
export function getSessionsCostUsd(
  sessionIds: number[],
): Map<number, number | null> {
  if (!sessionIds.length) return new Map();
  const totals = new Map<number, number | null>();
  for (const row of subtreeUsageRows(sessionIds)) {
    const cost = rowCost(row);
    const current = totals.get(row.rootId);
    if (cost === undefined || current === null) totals.set(row.rootId, null);
    else totals.set(row.rootId, (current ?? 0) + cost);
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
  /** This session's own spend, excluding subagents. */
  costUsd: number | null;
  costSource: CostSource;
  /** Descendant subagent spend; 0 when the session delegated nothing. */
  subagentCostUsd: number | null;
  /** Own + descendant spend, under the pricing-trust rule across the subtree. */
  totalCostUsd: number | null;
  totalCostSource: CostSource;
}

function totalCost(rows: UsageJoinRow[]): {
  costUsd: number | null;
  costSource: CostSource;
} {
  let costUsd = 0;
  let priced = true;
  let reported = rows.length > 0;
  for (const row of rows) {
    const cost = rowCost(row);
    if (cost === undefined) priced = false;
    else costUsd += cost;
    if (row.reportedCostUsd === null) reported = false;
  }
  const known = rows.length > 0 && priced;
  return {
    costUsd: known ? costUsd : null,
    costSource: known ? (reported ? "reported" : "estimated") : "unavailable",
  };
}

/**
 * Cost is derived at read time (never stored) so pricing-table updates
 * apply retroactively. Per the pricing-trust rule, a session only gets a
 * dollar figure when every token-bearing row is priced — either reported
 * by the provider or matched to a pricing entry. Own spend and the subagent
 * roll-up are reported separately so the detail view can show the breakdown;
 * `models` stays this session's own usage.
 */
export function getSessionUsage(sessionId: number): SessionUsageDetail {
  const subtree = subtreeUsageRows([sessionId]);
  const rows = subtree.filter((row) => row.sessionId === sessionId);
  const descendants = subtree.filter((row) => row.sessionId !== sessionId);
  const own = totalCost(rows);
  const total = totalCost(subtree);
  return {
    models: rows.map((row) => ({
      model: row.model,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheWriteTokens: row.cacheWriteTokens,
    })),
    ...own,
    subagentCostUsd: descendants.length
      ? totalCost(descendants).costUsd
      : /* nothing delegated: an honest zero, not an unknown */ 0,
    totalCostUsd: total.costUsd,
    totalCostSource: total.costSource,
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
  range: OverviewRange;
  selected: UsageWindow;
  today: UsageWindow;
  week: UsageWindow;
  month: UsageWindow;
  daily: { date: string; costUsd: number; tokens: number }[];
  byProvider: UsageBucket[];
  byModel: UsageBucket[];
  byProject: UsageBucket[];
}

/**
 * Aggregates per-session per-model usage for the selected range. Sessions
 * with any unpriced usage are excluded from dollar sums (and counted in
 * unpricedSessions) but still contribute to token totals. The by-model buckets
 * attribute dollars per model instead, so byModel cost can exceed the window
 * total when priced and unpriced models share a session. The fixed windows are
 * retained for now-scoped consumers such as the Sessions dashboard.
 */
export function getUsageSummary(range: OverviewRange = "30d"): UsageSummary {
  const selectedStart = overviewRangeStart(range);
  const monthStart = overviewRangeStart("30d");
  const rows = sqlite
    .prepare(
      `${USAGE_JOIN} ${range === "all" ? "" : "WHERE s.started_at >= ?"}`,
    )
    .all(...(range === "all" ? [] : [monthStart])) as UsageJoinRow[];

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
  const selected = emptyWindow();
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
    const windows: UsageWindow[] = [];
    if (monthStart !== null && session.startedAt >= monthStart) {
      windows.push(month);
    }
    if (session.startedAt >= weekStart) windows.push(week);
    if (session.startedAt >= todayStart) windows.push(today);
    for (const window of windows) {
      window.tokens += session.tokens;
      window.cacheReadTokens += session.cacheReadTokens;
      window.sessions += 1;
      if (session.priced) window.costUsd += costUsd;
      else window.unpricedSessions += 1;
    }
    if (selectedStart !== null && session.startedAt < selectedStart) continue;
    selected.tokens += session.tokens;
    selected.cacheReadTokens += session.cacheReadTokens;
    selected.sessions += 1;
    if (session.priced) selected.costUsd += costUsd;
    else selected.unpricedSessions += 1;
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

  const firstSelectedAt = [...bySession.values()]
    .filter(
      (session) => selectedStart === null || session.startedAt >= selectedStart,
    )
    .reduce<string | null>(
      (first, session) =>
        first === null || session.startedAt < first ? session.startedAt : first,
      null,
    );
  const dailySeries = dateSpan(
    overviewRangeDays(range) ?? 1,
    range === "all" ? firstSelectedAt : null,
  ).map((date) => {
    return { date, ...(daily.get(date) ?? { costUsd: 0, tokens: 0 }) };
  });
  const ranked = (map: Map<string, UsageBucket>) =>
    [...map.values()].sort(
      (a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens,
    );

  return {
    range,
    selected,
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
// 3-hour time-of-day bands per day (8 rows: 12a, 3a, … 9p).
const PATTERNS_HEATMAP_BANDS = 8;
const PATTERNS_HEATMAP_TIME_ZONE = "America/New_York";
// en-CA renders dates as YYYY-MM-DD, which doubles as a stable sort key.
const patternsHeatmapFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: PATTERNS_HEATMAP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

function patternsHeatmapCell(startedAt: string): {
  day: string;
  band: number;
} {
  const parts = patternsHeatmapFormatter.formatToParts(new Date(startedAt));
  const part = (type: string) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return {
    day: `${part("year")}-${part("month")}-${part("day")}`,
    band: Math.floor(Number(part("hour")) / 3),
  };
}

function patternsHeatmapDay(startedAt: string): string {
  return patternsHeatmapCell(startedAt).day;
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
 * usage tables. The heatmap always spans the trailing 30 days in
 * America/New_York time (a week is too sparse for a useful day x band grid);
 * the length histogram and period cost follow the selected range. The period
 * cost includes fully priced sessions and excludes sessions with any unpriced
 * usage, matching the aggregate behavior on the Usage page.
 */
export function getOverviewPatterns(
  range: OverviewRange = "7d",
): OverviewPatterns {
  // Length and cost windows track the selected range; the heatmap is always
  // 30 days because a 7-cell-wide grid is too sparse to read.
  const windowStart = overviewRangeStart(range);

  // --- heatmap: session starts per day x 3-hour band, always 30 days ---
  // Fetch one extra day so timezone offsets never clip the oldest cell, then
  // keep only starts that fall on one of the tracked local dates.
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
  const trackedDays = new Set(heatDays);
  const heatMap = new Map<string, number>();
  for (const row of heatRows) {
    const cell = patternsHeatmapCell(row.startedAt);
    if (!trackedDays.has(cell.day)) continue;
    const key = `${cell.day}:${cell.band}`;
    heatMap.set(key, (heatMap.get(key) ?? 0) + 1);
  }
  const heatmap = heatDays.flatMap((day) =>
    Array.from({ length: PATTERNS_HEATMAP_BANDS }, (_, band) => ({
      day,
      band,
      count: heatMap.get(`${day}:${band}`) ?? 0,
    })),
  );

  // --- length histogram: bucket runtime over the window ---
  const lengthRows = sqlite
    .prepare(
      `SELECT
        CAST((julianday(COALESCE(ended_at, updated_at)) - julianday(started_at)) * 86400000 AS INTEGER) AS runtimeMs
       FROM sessions
       WHERE ${windowStart ? "started_at >= ? AND " : ""}started_at <= ?`,
    )
    .all(...(windowStart ? [windowStart] : []), new Date().toISOString()) as {
    runtimeMs: number;
  }[];
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

  // --- period cost: sum fully priced sessions over the window ---
  const usageRows = sqlite
    .prepare(`${USAGE_JOIN} ${windowStart ? "WHERE s.started_at >= ?" : ""}`)
    .all(...(windowStart ? [windowStart] : [])) as UsageJoinRow[];
  let tokens = 0;
  const bySession = new Map<
    number,
    { costUsd: number; priced: boolean; byModel: Map<string, number> }
  >();
  for (const row of usageRows) {
    const rowTokens =
      row.inputTokens +
      row.outputTokens +
      row.cacheReadTokens +
      row.cacheWriteTokens;
    tokens += rowTokens;
    const cost = rowCost(row);
    const modelKey = normalizeModel(row.model);
    const session = bySession.get(row.sessionId) ?? {
      costUsd: 0,
      priced: true,
      byModel: new Map(),
    };
    if (cost === undefined) {
      session.priced = false;
    } else {
      session.costUsd += cost;
      session.byModel.set(
        modelKey,
        (session.byModel.get(modelKey) ?? 0) + cost,
      );
    }
    bySession.set(row.sessionId, session);
  }
  let costUsd = 0;
  const byModel = new Map<string, number>();
  for (const session of bySession.values()) {
    if (!session.priced) continue;
    costUsd += session.costUsd;
    for (const [model, modelCostUsd] of session.byModel) {
      byModel.set(model, (byModel.get(model) ?? 0) + modelCostUsd);
    }
  }
  const models = Array.from(byModel, ([model, cost]) => ({
    model,
    costUsd: cost,
  })).sort((a, b) => b.costUsd - a.costUsd);

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
      costUsd,
      tokens,
      models,
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

export interface CapabilityInsight {
  kind: "skill" | "mcp";
  name: string;
  invocations: number;
  sessionCount: number;
  lastUsedAt: string;
  providers: AgentProvider[];
  // Invocations credited to each provider that observed this capability.
  // Providers with no observations are absent, which the by-provider grid
  // reads differently depending on that provider's coverage.
  byProvider: Partial<Record<AgentProvider, number>>;
}

export interface UnusedCapabilityInsight {
  kind: "skill" | "mcp";
  name: string;
  providers: AgentProvider[];
  lastUsedAt: string | null;
  neverObserved: boolean;
}

export interface CapabilityCoverage {
  provider: AgentProvider;
  state: "complete" | "partial" | "unavailable";
  message?: string;
}

export interface CapabilitiesInsight {
  range: OverviewRange;
  used: CapabilityInsight[];
  unused: UnusedCapabilityInsight[];
  // Adoption denominator: distinct active installations across providers with
  // complete coverage, and how many of those were observed inside the range.
  // Both stay 0 while no provider has complete coverage, so the ratio is only
  // ever stated when it can be trusted.
  installedCount: number;
  installedUsedCount: number;
  coverage: CapabilityCoverage[];
}

export interface Insights {
  capabilities: CapabilitiesInsight;
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
    /** Main sessions ranked by rolled-up cost (own spend + subagents). */
    outliers: {
      id: number;
      title: string;
      model: string | null;
      costUsd: number;
      shareOfPeriodPct: number | null;
      runtimeMs: number;
      usdPerMin: number;
    }[];
    trend: { day: string; costUsd: number | null }[];
    signal: InsightSignal | null;
  };
}

interface CapabilityAggregateRow {
  kind: "skill" | "mcp";
  name: string;
  provider: string;
  invocations: number;
  sessionCount: number;
  lastUsedAt: string;
}

interface CapabilityHistoryRow {
  provider: string;
  kind: "skill" | "mcp";
  name: string;
  lastUsedAt: string;
}

interface AdapterScanCoverageRow {
  provider: string;
  sources: number;
  errors: number;
  capabilityReconciliationComplete: number;
}

const providerOrder = new Map(
  agentProviders.map((provider, index) => [provider, index]),
);

function orderedProviders(providers: Iterable<string>): AgentProvider[] {
  return [...new Set(providers)]
    .filter((provider): provider is AgentProvider =>
      agentProviders.includes(provider as AgentProvider),
    )
    .sort(
      (left, right) =>
        (providerOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (providerOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
    );
}

function capabilityHistoryKey(
  provider: AgentProvider,
  kind: "skill" | "mcp",
  name: string,
): string {
  return `${provider}:${kind}:${canonicalCapabilityName(name)}`;
}

function capabilityInsights(
  range: OverviewRange,
  inventories: AgentInventory[],
): CapabilitiesInsight {
  const rangeStart = overviewRangeStart(range);
  // Grouped per provider so the by-provider grid can shade each cell. Session
  // counts stay exact when folded because a session belongs to exactly one
  // provider, so the per-provider distinct counts never overlap.
  const aggregateRows = sqlite
    .prepare(
      `SELECT kind, LOWER(TRIM(capability_name)) name, provider,
        COUNT(*) invocations,
        COUNT(DISTINCT session_id) sessionCount,
        MAX(occurred_at) lastUsedAt
       FROM session_capability_usage
       WHERE ${rangeStart ? "occurred_at >= ? AND " : ""}kind IN ('skill', 'mcp')
       GROUP BY kind, LOWER(TRIM(capability_name)), provider`,
    )
    .all(...(rangeStart ? [rangeStart] : [])) as CapabilityAggregateRow[];

  const scanRows = sqlite
    .prepare(
      `SELECT provider, sources, errors,
              capability_reconciliation_complete capabilityReconciliationComplete
       FROM adapter_scans`,
    )
    .all() as AdapterScanCoverageRow[];
  const scans = new Map(scanRows.map((row) => [row.provider, row]));
  const coverage: CapabilityCoverage[] = agentProviders.map((provider) => {
    const scan = scans.get(provider);
    if (!scan || scan.sources === 0) return { provider, state: "unavailable" };
    if (
      scan.errors > 0 ||
      (provider === "zcode" && scan.capabilityReconciliationComplete !== 1)
    ) {
      return { provider, state: "partial" };
    }
    return { provider, state: "complete" };
  });
  const coverageByProvider = new Map(
    coverage.map((item) => [item.provider, item.state]),
  );

  const historyRows = sqlite
    .prepare(
      `SELECT provider, kind, LOWER(TRIM(capability_name)) name,
        MAX(occurred_at) lastUsedAt
       FROM session_capability_usage
       WHERE kind IN ('skill', 'mcp')
       GROUP BY provider, kind, LOWER(TRIM(capability_name))`,
    )
    .all() as CapabilityHistoryRow[];
  const installationsByCapability = new Map<
    string,
    UnusedCapabilityInsight & {
      providerSet: Set<AgentProvider>;
      usedInRange: boolean;
    }
  >();
  const seenInstallations = new Set<string>();
  const aliasCandidates = new Map<string, Set<string>>();
  const installedKeys = new Set<string>();
  for (const inventory of inventories) {
    if (coverageByProvider.get(inventory.provider) !== "complete") continue;
    for (const installed of inventory.capabilities) {
      if (
        (installed.kind !== "skill" && installed.kind !== "mcp") ||
        (installed.status !== "enabled" && installed.status !== "installed")
      ) {
        continue;
      }
      const baseName = canonicalCapabilityName(installed.name);
      if (!baseName) continue;
      const pluginName = canonicalCapabilityName(
        installed.sourcePlugin?.split("@")[0] ?? "",
      );
      const name =
        installed.kind === "skill" && pluginName
          ? baseName.startsWith(`${pluginName}:`)
            ? baseName
            : `${pluginName}:${baseName}`
          : baseName;
      const installationKey = capabilityHistoryKey(
        inventory.provider,
        installed.kind,
        name,
      );
      if (seenInstallations.has(installationKey)) continue;
      seenInstallations.add(installationKey);
      const groupKey = `${installed.kind}:${name}`;
      installedKeys.add(groupKey);
      for (const alias of new Set([baseName, name])) {
        const aliasKey = capabilityHistoryKey(
          inventory.provider,
          installed.kind,
          alias,
        );
        const candidates = aliasCandidates.get(aliasKey) ?? new Set<string>();
        candidates.add(groupKey);
        aliasCandidates.set(aliasKey, candidates);
      }

      const current = installationsByCapability.get(groupKey) ?? {
        kind: installed.kind,
        name,
        providers: [],
        providerSet: new Set<AgentProvider>(),
        lastUsedAt: null,
        neverObserved: true,
        usedInRange: false,
      };
      current.providerSet.add(inventory.provider);
      installationsByCapability.set(groupKey, current);
    }
  }

  const eligibleAliases = new Map<string, string>();
  for (const [alias, candidates] of aliasCandidates) {
    if (candidates.size === 1) {
      eligibleAliases.set(alias, [...candidates][0]);
    }
  }

  const installedUsedKeys = new Set<string>();
  for (const row of historyRows) {
    if (!agentProviders.includes(row.provider as AgentProvider)) continue;
    const provider = row.provider as AgentProvider;
    const groupKey = eligibleAliases.get(
      capabilityHistoryKey(provider, row.kind, row.name),
    );
    if (!groupKey) continue;
    const current = installationsByCapability.get(groupKey);
    if (!current) continue;
    if (current.lastUsedAt === null || row.lastUsedAt > current.lastUsedAt) {
      current.lastUsedAt = row.lastUsedAt;
    }
    current.neverObserved = false;
    if (rangeStart === null || row.lastUsedAt >= rangeStart) {
      current.usedInRange = true;
      installedUsedKeys.add(groupKey);
    }
  }

  const folded = new Map<string, CapabilityInsight>();
  for (const row of aggregateRows) {
    if (!agentProviders.includes(row.provider as AgentProvider)) continue;
    const provider = row.provider as AgentProvider;
    const key = eligibleAliases.get(
      capabilityHistoryKey(provider, row.kind, row.name),
    );
    if (!key) continue;
    const installation = installationsByCapability.get(key);
    if (!installation) continue;
    const current = folded.get(key) ?? {
      kind: row.kind,
      name: installation.name,
      invocations: 0,
      sessionCount: 0,
      lastUsedAt: row.lastUsedAt,
      providers: [],
      byProvider: {},
    };
    current.invocations += row.invocations;
    current.sessionCount += row.sessionCount;
    if (row.lastUsedAt > current.lastUsedAt) {
      current.lastUsedAt = row.lastUsedAt;
    }
    current.byProvider[provider] = row.invocations;
    current.providers = orderedProviders(Object.keys(current.byProvider));
    folded.set(key, current);
  }

  const ranked = [...folded.values()].sort(
    (left, right) =>
      right.invocations - left.invocations ||
      right.sessionCount - left.sessionCount ||
      right.lastUsedAt.localeCompare(left.lastUsedAt) ||
      left.name.localeCompare(right.name),
  );
  const used = (["skill", "mcp"] as const).flatMap((kind) =>
    ranked.filter((item) => item.kind === kind),
  );

  const unused = [...installationsByCapability.values()]
    .filter((item) => !item.usedInRange)
    .map(({ kind, name, providerSet, lastUsedAt, neverObserved }) => ({
      kind,
      name,
      providers: orderedProviders(providerSet),
      lastUsedAt,
      neverObserved,
    }))
    .sort((left, right) => {
      if (left.neverObserved !== right.neverObserved)
        return left.neverObserved ? -1 : 1;
      if (left.lastUsedAt === null && right.lastUsedAt !== null) return -1;
      if (left.lastUsedAt !== null && right.lastUsedAt === null) return 1;
      return (
        (left.lastUsedAt ?? "").localeCompare(right.lastUsedAt ?? "") ||
        left.name.localeCompare(right.name)
      );
    });

  return {
    range,
    used,
    unused,
    installedCount: installedKeys.size,
    installedUsedCount: installedUsedKeys.size,
    coverage,
  };
}

// Aggregate cache hit-rate and $-saved over a window of usage rows.
// hitRate = cache reads / all input tokens: reads, uncached input, and cache
// writes. Cache writes are misses because that content was not already cached.
// savedUsd requires every row priced: it is the gap between actual cost and the
// counterfactual where cache_read_tokens are re-priced at the full input rate.
function aggregateCache(rows: UsageJoinRow[]) {
  let read = 0;
  let input = 0;
  let writes = 0;
  let grossCost = 0; // actual cost (cache reads at cache-read rate)
  let counterfactual = 0; // if cache reads were priced as full input
  let priced = true;
  const byModel = new Map<
    string,
    { read: number; input: number; writes: number; tokens: number }
  >();
  for (const row of rows) {
    read += row.cacheReadTokens;
    input += row.inputTokens;
    writes += row.cacheWriteTokens;
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
    const model = byModel.get(key) ?? {
      read: 0,
      input: 0,
      writes: 0,
      tokens: 0,
    };
    model.read += row.cacheReadTokens;
    model.input += row.inputTokens;
    model.writes += row.cacheWriteTokens;
    model.tokens +=
      row.inputTokens +
      row.outputTokens +
      row.cacheReadTokens +
      row.cacheWriteTokens;
    byModel.set(key, model);
  }
  const hitRate =
    read + input + writes > 0 ? read / (read + input + writes) : null;
  const savedUsd =
    priced && counterfactual > grossCost ? counterfactual - grossCost : null;
  const savedSharePct =
    savedUsd !== null && counterfactual > 0
      ? (savedUsd / counterfactual) * 100
      : null;
  const byModelOut = [...byModel.entries()]
    .map(([model, m]) => ({
      model,
      hitRate:
        m.read + m.input + m.writes > 0
          ? m.read / (m.read + m.input + m.writes)
          : 0,
      tokens: m.tokens,
    }))
    .sort((a, b) => b.tokens - a.tokens);
  // NOTE: happy-path $-saved has no regression test because the shared fixture's
  // unpriced s4 forces null across the week window (pricing-trust rule).
  return {
    hitRate,
    savedUsd,
    savedSharePct,
    byModel: byModelOut,
    read,
    input,
    writes,
  };
}

/**
 * Two actionable efficiency cards derived from existing usage data.
 * Cache hit rate is token-only and always available. Cache $-saved follows
 * the all-rows pricing-trust rule; period cost totals include fully priced
 * sessions and exclude sessions with any unpriced usage. Signals are curated
 * and rule-based.
 */
export function getInsights(
  range: OverviewRange = "7d",
  inventories: AgentInventory[] = [],
): Insights {
  const rangeDays = overviewRangeDays(range);
  const rangeStart = overviewRangeStart(range);
  const priorRangeStart =
    rangeDays === null
      ? null
      : new Date(Date.now() - rangeDays * 2 * DAY_MS).toISOString();
  const trendStart = new Date(
    Date.now() - INSIGHTS_TREND_DAYS * DAY_MS,
  ).toISOString();

  const weekRows = sqlite
    .prepare(`${USAGE_JOIN} ${rangeStart ? "WHERE s.started_at >= ?" : ""}`)
    .all(...(rangeStart ? [rangeStart] : [])) as UsageJoinRow[];
  const priorRows =
    priorRangeStart && rangeStart
      ? (sqlite
          .prepare(`${USAGE_JOIN} WHERE s.started_at >= ? AND s.started_at < ?`)
          .all(priorRangeStart, rangeStart) as UsageJoinRow[])
      : [];
  const trendRows = sqlite
    .prepare(`${USAGE_JOIN} WHERE s.started_at >= ?`)
    .all(trendStart) as UsageJoinRow[];

  // --- cost outliers: per-session cost + runtime over the selected window ---
  interface CostRow {
    id: number;
    externalId: string;
    parentExternalId: string | null;
    title: string;
    model: string | null;
    provider: AgentProvider;
    startedAt: string;
    runtimeMs: number;
  }
  const costSessionRows = sqlite
    .prepare(
      `SELECT s.id, s.external_id externalId, s.parent_external_id parentExternalId,
        s.title, s.model, s.provider, s.started_at startedAt,
        CAST((julianday(COALESCE(s.ended_at, s.updated_at)) - julianday(s.started_at)) * 86400000 AS INTEGER) AS runtimeMs
       FROM sessions s ${rangeStart ? "WHERE s.started_at >= ?" : ""}`,
    )
    .all(...(rangeStart ? [rangeStart] : [])) as CostRow[];

  // --- cache effectiveness ---
  const weekCache = aggregateCache(weekRows);
  const priorCache = aggregateCache(priorRows);
  const hitRateDeltaPts =
    range !== "all" && weekCache.hitRate !== null && priorCache.hitRate !== null
      ? (weekCache.hitRate - priorCache.hitRate) * 100
      : null;
  const cacheSignal: InsightSignal | null =
    hitRateDeltaPts !== null && hitRateDeltaPts <= -CACHE_DROP_THRESHOLD_PTS
      ? {
          tone: "warning",
          text: `Cache hit rate dropped ${Math.round(Math.abs(hitRateDeltaPts))} points ${range === "7d" ? "week-over-week" : "vs. the previous 30 days"} — long sessions may be losing context.`,
        }
      : null;

  // 30-day daily hit-rate trend, grouped by session start day.
  const trendByDay = new Map<
    string,
    { read: number; input: number; writes: number }
  >();
  for (const row of trendRows) {
    const day = row.startedAt.slice(0, 10);
    const entry = trendByDay.get(day) ?? { read: 0, input: 0, writes: 0 };
    entry.read += row.cacheReadTokens;
    entry.input += row.inputTokens;
    entry.writes += row.cacheWriteTokens;
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
        entry && entry.read + entry.input + entry.writes > 0
          ? entry.read / (entry.read + entry.input + entry.writes)
          : null,
    };
  });

  // --- cost outliers ---
  // Spend rolls up to the session that delegated it, matching the per-session
  // cost shown everywhere else: a main session's figure is its own priced
  // usage plus every descendant subagent's. Attribution is resolved *within
  // selected window* — a session whose parent started before the window is
  // its own root here — so the roll-ups still sum to exactly periodTotalUsd and
  // Pareto shares stay bounded. Sessions with any unpriced usage contribute
  // nothing to the period total or outlier roll-ups. runtimeMs comes from
  // costSessionRows.
  const runtimeById = new Map(costSessionRows.map((row) => [row.id, row]));
  const byExternalId = new Map(
    costSessionRows.map((row) => [`${row.provider}:${row.externalId}`, row]),
  );
  const rootIdCache = new Map<number, number>();
  const rootIdOf = (sessionId: number): number => {
    const cached = rootIdCache.get(sessionId);
    if (cached !== undefined) return cached;
    // Walk to the topmost in-window ancestor. `seen` guards against a cycle a
    // malformed rollout could introduce; the chain then roots at its entry.
    const seen = new Set<number>();
    let current = runtimeById.get(sessionId);
    let root = sessionId;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      root = current.id;
      current = current.parentExternalId
        ? byExternalId.get(`${current.provider}:${current.parentExternalId}`)
        : undefined;
    }
    rootIdCache.set(sessionId, root);
    return root;
  };

  const ownSessionCosts = new Map<
    number,
    { costUsd: number; priced: boolean }
  >();
  for (const row of weekRows) {
    const session = ownSessionCosts.get(row.sessionId) ?? {
      costUsd: 0,
      priced: true,
    };
    const cost = rowCost(row);
    if (cost === undefined) {
      session.priced = false;
    } else {
      session.costUsd += cost;
    }
    ownSessionCosts.set(row.sessionId, session);
  }

  const sessionCost = new Map<number, number>();
  let weekTotalUsd = 0;
  for (const [sessionId, session] of ownSessionCosts) {
    if (!session.priced) continue;
    weekTotalUsd += session.costUsd;
    const rootId = rootIdOf(sessionId);
    sessionCost.set(rootId, (sessionCost.get(rootId) ?? 0) + session.costUsd);
  }

  // Outliers: top 5 by rolled-up session cost. usdPerMin measures the whole
  // delegated tree against the main session's wall clock, since subagents run
  // inside it. Zero/negative runtime is floored at a minute.
  const outliers = [...sessionCost.entries()]
    .map(([id, costUsd]) => {
      const meta = runtimeById.get(id);
      const runtimeMs = meta?.runtimeMs ?? 0;
      const minutes = Math.max(runtimeMs / 60_000, 1);
      return {
        id,
        title: meta?.title ?? "Untitled",
        model: meta?.model ?? null,
        costUsd,
        shareOfPeriodPct: null as number | null,
        runtimeMs,
        usdPerMin: costUsd / minutes,
      };
    })
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 5);

  for (const outlier of outliers) {
    outlier.shareOfPeriodPct =
      weekTotalUsd !== null && weekTotalUsd > 0
        ? (outlier.costUsd / weekTotalUsd) * 100
        : null;
  }

  // Pareto: share of period cost held by the top 3 sessions. Null when there
  // is no priced spend.
  const top3Cost = outliers.slice(0, 3).reduce((sum, o) => sum + o.costUsd, 0);
  let paretoSharePct: number | null = null;
  if (weekTotalUsd !== null && weekTotalUsd > 0) {
    paretoSharePct = (top3Cost / weekTotalUsd) * 100;
  }
  // Top-5 headline share: share of week cost held by the top 5 sessions (a
  // distinct figure from the top-3 signal threshold above).
  const top5Cost = outliers.slice(0, 5).reduce((sum, o) => sum + o.costUsd, 0);
  const top5SharePct =
    weekTotalUsd !== null && weekTotalUsd > 0
      ? (top5Cost / weekTotalUsd) * 100
      : null;
  const costSignal: InsightSignal | null =
    paretoSharePct !== null && paretoSharePct >= 50
      ? {
          tone: "warning",
          text: `Three sessions drove ${Math.round(paretoSharePct)}% of ${range === "7d" ? "this week's" : range === "30d" ? "the last 30 days'" : "all-time"} cost — inspect them for loops or retries.`,
        }
      : null;

  // Cost trend reuses the existing getUsageSummary daily series rather than
  // recomputing it (keeps a single source of truth for daily cost).
  // Priced-only daily series (matches /usage).
  const costTrend = getUsageSummary().daily.map((d) => ({
    day: d.date,
    costUsd: d.costUsd,
  }));

  return {
    capabilities: capabilityInsights(range, inventories),
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
