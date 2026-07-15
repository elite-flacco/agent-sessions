"use client";

import {
  AlertTriangle,
  ChevronDown,
  CircleDot,
  Database,
  ExternalLink,
  FolderKanban,
  LoaderCircle,
  RefreshCw,
  Search,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  absoluteTime,
  elapsed,
  formatCostUsd,
  relativeTime,
  runtime,
} from "@/lib/format";
import { providerBadges, providerLabels, statusLabels } from "@/lib/labels";
import type {
  ProjectSummary,
  SessionFilters,
  SessionTreeItem,
  UsageWindow,
} from "@/lib/queries";

export type WorkspaceView = "sessions" | "projects";

interface DashboardProps {
  sessions: SessionTreeItem[];
  projects: ProjectSummary[];
  summary: {
    sessionsToday: number;
    activeNow: number;
    totalRuntimeMs: number;
    connectedAgents: number;
  };
  syncState: { lastSyncedAt: string | null; errors: number; sources: number };
  costToday: UsageWindow;
  filters: SessionFilters;
  view: WorkspaceView;
}

function sessionCount(sessions: SessionTreeItem[]): number {
  return sessions.reduce(
    (total, session) => total + 1 + sessionCount(session.children),
    0,
  );
}

export function Dashboard({
  sessions,
  projects,
  summary,
  syncState,
  costToday,
  filters,
  view,
}: DashboardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(filters.q ?? "");
  const [isSyncing, setIsSyncing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function focusSearch(event: globalThis.KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  function updateParam(name: string, value?: string): void {
    const params = new URLSearchParams(window.location.search);
    const isDefault =
      !value ||
      (name !== "range" && value === "all") ||
      (name === "range" && value === "7d") ||
      (name === "view" && value === "sessions");
    if (isDefault) params.delete(name);
    else params.set(name, value);
    startTransition(() =>
      router.replace(
        params.size ? `${pathname}?${params.toString()}` : pathname,
      ),
    );
  }

  useEffect(() => {
    const timer = window.setTimeout(() => updateParam("q", query.trim()), 300);
    return () => window.clearTimeout(timer);
    // The URL should update only when the controlled input changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [router]);

  async function sync(): Promise<void> {
    setIsSyncing(true);
    try {
      await fetch("/api/sync", { method: "POST" });
      router.refresh();
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <section className="relay-content">
      <header className="page-header">
        <div>
          <h1>Sessions</h1>
          <p>Browse individual runs and project-level rollups in one place.</p>
        </div>
        <button
          className="btn btn-outline"
          onClick={sync}
          disabled={isSyncing}
          aria-label="Sync agent activity"
        >
          {isSyncing ? (
            <LoaderCircle className="animate-spin" size={14} />
          ) : (
            <RefreshCw size={14} />
          )}
          {isSyncing
            ? "Syncing…"
            : syncState.lastSyncedAt
              ? `Synced ${relativeTime(syncState.lastSyncedAt)}`
              : "Sync activity"}
        </button>
      </header>

      <div className="summary-grid" aria-label="Workspace summary">
        <Metric
          label="Sessions today"
          value={String(summary.sessionsToday)}
          note={
            syncState.sources
              ? `${syncState.sources} local sources indexed`
              : "Run your first sync"
          }
        />
        <Metric
          label="Active now"
          value={String(summary.activeNow)}
          note="Updated from recent activity"
          accent
        />
        <Metric
          label="Total runtime"
          value={runtime(summary.totalRuntimeMs)}
          note="Across today’s sessions"
        />
        <Metric
          label="Est. cost today"
          value={formatCostUsd(costToday.costUsd)}
          note={
            costToday.unpricedSessions
              ? `${costToday.unpricedSessions} sessions without pricing`
              : "API-equivalent estimate"
          }
        />
      </div>

      <div className="filter-row">
        <label className="search-control">
          <Search size={14} />
          <input
            ref={searchRef}
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search sessions, repos, branches…"
            aria-label="Search sessions and projects"
          />
          <kbd>⌘ K</kbd>
        </label>
        <FilterSelect
          label="Filter by agent"
          value={filters.provider ?? "all"}
          onChange={(value) => updateParam("provider", value)}
          options={[
            { value: "all", label: "All agents" },
            ...Object.entries(providerLabels).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
        />
        <FilterSelect
          label="Filter by status"
          value={filters.status ?? "all"}
          onChange={(value) => updateParam("status", value)}
          options={[
            { value: "all", label: "All statuses" },
            { value: "attention", label: "Attention (failed)" },
            ...Object.entries(statusLabels).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
        />
        <FilterSelect
          label="Date range"
          value={filters.range ?? "7d"}
          onChange={(value) => updateParam("range", value)}
          options={[
            { value: "today", label: "Today" },
            { value: "7d", label: "Last 7 days" },
            { value: "30d", label: "Last 30 days" },
            { value: "all", label: "All time" },
          ]}
          compact
        />
      </div>

      {syncState.errors > 0 && (
        <div className="notice">
          <AlertTriangle size={15} />
          <span>
            {syncState.errors} source files could not be parsed. Other providers
            remain available.
          </span>
        </div>
      )}

      <div className="workspace-switcher" role="tablist" aria-label="Browse by">
        <button
          className={
            view === "sessions" ? "workspace-tab tab-active" : "workspace-tab"
          }
          role="tab"
          aria-selected={view === "sessions"}
          onClick={() => updateParam("view", "sessions")}
        >
          <Database size={14} />
          Sessions
          <span>{sessionCount(sessions)}</span>
        </button>
        <button
          className={
            view === "projects" ? "workspace-tab tab-active" : "workspace-tab"
          }
          role="tab"
          aria-selected={view === "projects"}
          onClick={() => updateParam("view", "projects")}
        >
          <FolderKanban size={14} />
          Projects
          <span>{projects.length}</span>
        </button>
      </div>

      <div className={isPending ? "workspace-loading" : ""}>
        {view === "projects" ? (
          <ProjectsTable projects={projects} isPending={isPending} />
        ) : (
          <SessionsTable
            sessions={sessions}
            filters={filters}
            isPending={isPending}
            onSync={sync}
          />
        )}
      </div>
    </section>
  );
}

function SessionsTable({
  sessions,
  filters,
  isPending,
  onSync,
}: {
  sessions: SessionTreeItem[];
  filters: SessionFilters;
  isPending: boolean;
  onSync: () => void;
}) {
  return (
    <section
      className="session-panel workspace-table"
      aria-label="Agent sessions"
    >
      <div className="session-table-head">
        <span>Session</span>
        <span>Agent</span>
        <span>Status</span>
        <span>Started</span>
        <span>Duration</span>
      </div>
      {sessions.length ? (
        sessions.map((session) => (
          <SessionRow key={session.id} session={session} depth={0} />
        ))
      ) : (
        <EmptyState
          hasFilters={Boolean(filters.q || filters.provider || filters.status)}
          onSync={onSync}
        />
      )}
      <footer className="session-footer">
        <span>Showing {sessionCount(sessions)} sessions</span>
        <span>{isPending ? "Updating…" : "Updated from local files"}</span>
      </footer>
    </section>
  );
}

function SessionRow({
  session,
  depth,
}: {
  session: SessionTreeItem;
  depth: number;
}) {
  return (
    <>
      <div className={depth ? "session-row session-child-row" : "session-row"}>
        <div className="session-primary">
          <div className="session-title-actions">
            <Link href={`/sessions/${session.id}`}>{session.title}</Link>
            <Link
              href={`/sessions/${session.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="session-open-link"
              aria-label={`Open ${session.title} in a new tab`}
              title="Open in new tab"
            >
              <ExternalLink size={13} />
            </Link>
          </div>
          <span className="mono">
            {session.sessionKind === "subagent"
              ? `Subagent${session.agentLabel ? ` · ${session.agentLabel}` : ""}`
              : (session.repository ?? "Unknown workspace")}
            {session.sessionKind !== "subagent" && session.branch
              ? ` · ${session.branch}`
              : ""}
            {session.children.length
              ? ` · ${session.children.length} subagent${session.children.length === 1 ? "" : "s"}`
              : ""}
          </span>
        </div>
        <div>
          <span className={`badge ${providerBadges[session.provider]}`}>
            {providerLabels[session.provider]}
          </span>
        </div>
        <div className={`status-label status-${session.status}`}>
          <i />
          {statusLabels[session.status]}
        </div>
        <span
          className="mono session-secondary"
          title={absoluteTime(session.startedAt)}
        >
          {relativeTime(session.startedAt)}
        </span>
        <span className="mono session-secondary">
          {elapsed(session.startedAt, session.endedAt ?? session.updatedAt)}
        </span>
      </div>
      {session.children.map((child) => (
        <SessionRow key={child.id} session={child} depth={depth + 1} />
      ))}
    </>
  );
}

function ProjectsTable({
  projects,
  isPending,
}: {
  projects: ProjectSummary[];
  isPending: boolean;
}) {
  const projectCount = projects.filter(
    (project) => project.category === "project",
  ).length;
  const taskGroup = projects.find((project) => project.category === "task");
  return (
    <section className="session-panel workspace-table" aria-label="Projects">
      <div className="project-table-head session-table-head">
        <span>Project</span>
        <span>Agents</span>
        <span>Sessions</span>
        <span>Runtime</span>
        <span>Last activity</span>
      </div>
      {projects.length ? (
        projects.map((project) => (
          <div key={project.key} className="project-row session-row">
            <div className="session-primary">
              <strong>
                {project.category === "task" ? "Tasks" : project.repository}
                {project.activeCount > 0 && (
                  <span className="project-active-dot" aria-hidden />
                )}
              </strong>
              <span className="mono">
                {project.category === "task"
                  ? `${project.workdirs.length} one-off workspaces without Git context`
                  : project.workdirs.length
                    ? project.workdirs.join(" · ")
                    : "No working directory recorded"}
              </span>
            </div>
            <div className="project-badges">
              {project.providers.map((provider) => (
                <span
                  key={provider}
                  className={`badge ${providerBadges[provider]}`}
                >
                  {providerLabels[provider]}
                </span>
              ))}
            </div>
            <span className="mono session-secondary">
              {project.sessionCount}
              {project.activeCount > 0
                ? ` (${project.activeCount} active)`
                : ""}
            </span>
            <span className="mono session-secondary">
              {runtime(project.totalRuntimeMs)}
            </span>
            <span
              className="mono session-secondary"
              title={absoluteTime(project.lastActivityAt)}
            >
              {relativeTime(project.lastActivityAt)}
            </span>
          </div>
        ))
      ) : (
        <div className="empty-state">
          <FolderKanban size={24} />
          <h3>No matching projects</h3>
          <p>Adjust the shared filters to widen the project rollup.</p>
        </div>
      )}
      <footer className="session-footer">
        <span>
          Showing {projectCount} projects
          {taskGroup ? ` · ${taskGroup.sessionCount} tasks` : ""}
        </span>
        <span>
          {isPending ? "Updating…" : "Updated from filtered sessions"}
        </span>
      </footer>
    </section>
  );
}

function Metric({
  label,
  value,
  note,
  accent,
}: {
  label: string;
  value: string;
  note: string;
  accent?: boolean;
}) {
  return (
    <article className="metric">
      <span className="eyebrow">{label}</span>
      <strong>{value}</strong>
      <span className={accent ? "metric-accent" : ""}>
        {accent && <CircleDot size={10} />}
        {note}
      </span>
    </article>
  );
}

interface FilterSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  compact?: boolean;
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  compact,
}: FilterSelectProps) {
  return (
    <label
      className={compact ? "filter-select filter-compact" : "filter-select"}
    >
      <select
        className="select"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown size={13} />
    </label>
  );
}

function EmptyState({
  hasFilters,
  onSync,
}: {
  hasFilters: boolean;
  onSync: () => void;
}) {
  return (
    <div className="empty-state">
      <Database size={24} />
      <h3>{hasFilters ? "No matching sessions" : "No sessions indexed yet"}</h3>
      <p>
        {hasFilters
          ? "Try clearing a filter or widening the date range."
          : "Import local agent activity to populate Relay."}
      </p>
      {!hasFilters && (
        <button className="btn btn-primary" onClick={onSync}>
          <RefreshCw size={14} />
          Sync activity
        </button>
      )}
    </div>
  );
}
