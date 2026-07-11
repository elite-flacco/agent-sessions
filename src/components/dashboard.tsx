"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  Check,
  ChevronDown,
  CircleDot,
  Clock3,
  Code2,
  Command,
  Database,
  FileCode2,
  FolderKanban,
  LayoutDashboard,
  LoaderCircle,
  MoreHorizontal,
  RefreshCw,
  Search,
  Settings,
  TerminalSquare,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import type {
  SessionEventRow,
  SessionFilters,
  SessionListItem,
} from "@/lib/queries";
import type { AgentProvider, SessionStatus } from "@/lib/types";

interface DashboardProps {
  sessions: SessionListItem[];
  selected: SessionListItem | null;
  events: SessionEventRow[];
  summary: {
    sessionsToday: number;
    activeNow: number;
    totalRuntimeMs: number;
    connectedAgents: number;
  };
  syncState: { lastSyncedAt: string | null; errors: number; sources: number };
  filters: SessionFilters;
}

const providerLabels: Record<AgentProvider, string> = {
  codex: "Codex",
  claude: "Claude Code",
  zcode: "Zcode",
  pi: "Pi",
};
const providerBadges: Record<AgentProvider, string> = {
  codex: "badge-1",
  claude: "badge-4",
  zcode: "badge-3",
  pi: "badge-2",
};
const statusLabels: Record<SessionStatus, string> = {
  running: "Running",
  completed: "Completed",
  needs_attention: "Needs attention",
  interrupted: "Interrupted",
  unknown: "Unknown",
};

function elapsed(start: string, end?: string | null): string {
  const milliseconds = Math.max(
    0,
    new Date(end ?? Date.now()).getTime() - new Date(start).getTime(),
  );
  const minutes = Math.floor(milliseconds / 60_000);
  return minutes < 60
    ? `${minutes}m`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function relativeTime(value: string): string {
  const date = new Date(value);
  const diffMinutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffMinutes < 1440)
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function runtime(value: number): string {
  const minutes = Math.round(value / 60_000);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function tokens(session: SessionListItem): string {
  const total = (session.inputTokens ?? 0) + (session.outputTokens ?? 0);
  return total
    ? `${(total / 1000).toFixed(total > 10000 ? 1 : 2)}k`
    : "Unavailable";
}

export function Dashboard({
  sessions,
  selected,
  events,
  summary,
  syncState,
  filters,
}: DashboardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(filters.q ?? "");
  const [isSyncing, setIsSyncing] = useState(false);
  const [isPending, startTransition] = useTransition();

  function updateParam(name: string, value?: string): void {
    const params = new URLSearchParams(window.location.search);
    const isDefault =
      !value ||
      (name !== "range" && value === "all") ||
      (name === "range" && value === "7d");
    if (isDefault) params.delete(name);
    else params.set(name, value);
    if (name !== "selected") params.delete("selected");
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
    <main className="relay-shell">
      <aside className="relay-sidebar">
        <div className="brand-block">
          <div className="brand-mark">R</div>
          <div className="brand-copy">
            <strong>Relay</strong>
            <span>Agent operations</span>
          </div>
        </div>
        <nav aria-label="Primary navigation" className="primary-nav">
          <NavRow icon={<LayoutDashboard size={15} />} label="Overview" />
          <button className="nav-row nav-active" aria-current="page">
            <Database size={15} />
            <span>Sessions</span>
            <small>{sessions.length}</small>
          </button>
          <NavRow icon={<Activity size={15} />} label="Live activity" />
          <NavRow icon={<FolderKanban size={15} />} label="Projects" />
          <NavRow icon={<BarChart3 size={15} />} label="Usage & cost" />
        </nav>
        <div className="sidebar-footer">
          <div className="connection-card">
            <CircleDot size={14} />
            <div>
              <strong>{summary.connectedAgents} agents connected</strong>
              <span>
                {syncState.errors
                  ? `${syncState.errors} sources need attention`
                  : "Local data only"}
              </span>
            </div>
          </div>
          <NavRow icon={<Settings size={15} />} label="Settings" />
          <div className="profile-row">
            <div className="avatar">SS</div>
            <div>
              <strong>Shuang Song</strong>
              <span>Personal workspace</span>
            </div>
            <MoreHorizontal size={15} />
          </div>
        </div>
      </aside>

      <section className="relay-content">
        <header className="page-header">
          <div>
            <h1>Sessions</h1>
            <p>Every coding agent, one activity stream.</p>
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
            value="Unavailable"
            note="Shown only with trusted pricing"
          />
        </div>

        <div className="filter-row">
          <label className="search-control">
            <Search size={14} />
            <input
              className="input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search sessions, repos, branches…"
              aria-label="Search sessions"
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
              {syncState.errors} source files could not be parsed. Other
              providers remain available.
            </span>
          </div>
        )}
        <div
          className={`workspace-grid ${isPending ? "workspace-loading" : ""}`}
        >
          <section className="session-panel" aria-label="Agent sessions">
            <div className="session-table-head">
              <span>Session</span>
              <span>Agent</span>
              <span>Status</span>
              <span>Started</span>
              <span>Duration</span>
            </div>
            {sessions.length ? (
              sessions.map((session) => (
                <button
                  key={session.id}
                  className={`session-row ${selected?.id === session.id ? "session-selected" : ""}`}
                  onClick={() => updateParam("selected", String(session.id))}
                >
                  <div className="session-primary">
                    <strong>{session.title}</strong>
                    <span className="mono">
                      {session.repository ?? "Unknown workspace"}
                      {session.branch ? ` · ${session.branch}` : ""}
                    </span>
                  </div>
                  <div>
                    <span
                      className={`badge ${providerBadges[session.provider]}`}
                    >
                      {providerLabels[session.provider]}
                    </span>
                  </div>
                  <div className={`status-label status-${session.status}`}>
                    <i />
                    {statusLabels[session.status]}
                  </div>
                  <span className="mono session-secondary">
                    {relativeTime(session.startedAt)}
                  </span>
                  <span className="mono session-secondary">
                    {elapsed(
                      session.startedAt,
                      session.endedAt ?? session.updatedAt,
                    )}
                  </span>
                </button>
              ))
            ) : (
              <EmptyState
                hasFilters={Boolean(
                  filters.q || filters.provider || filters.status,
                )}
                onSync={sync}
              />
            )}
            <footer className="session-footer">
              <span>Showing {sessions.length} sessions</span>
              <span>
                {isPending ? "Updating…" : "Updated from local files"}
              </span>
            </footer>
          </section>
          <SessionInspector session={selected} events={events} />
        </div>
      </section>
    </main>
  );
}

function NavRow({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <button
      className="nav-row nav-upcoming"
      disabled
      title={`${label} is coming soon`}
    >
      {icon}
      <span>{label}</span>
      <small>SOON</small>
    </button>
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

function SessionInspector({
  session,
  events,
}: {
  session: SessionListItem | null;
  events: SessionEventRow[];
}) {
  if (!session)
    return (
      <aside className="inspector inspector-empty">
        <Database size={24} />
        <p>Select a session to inspect its activity.</p>
      </aside>
    );
  return (
    <aside className="inspector">
      <div className="inspector-heading">
        <span className="mono">
          {session.provider.toUpperCase()} · {session.externalId.slice(0, 8)}
        </span>
        <MoreHorizontal size={16} />
      </div>
      <h2>{session.title}</h2>
      <div className="inspector-badges">
        <span className={`badge ${providerBadges[session.provider]}`}>
          {providerLabels[session.provider]}
        </span>
        <span className={`status-label status-${session.status}`}>
          <i />
          {statusLabels[session.status]}
        </span>
      </div>
      <p>{session.summary}</p>
      <div className="detail-grid">
        <Detail
          label="Repository"
          value={session.repository ?? "Unavailable"}
        />
        <Detail label="Branch" value={session.branch ?? "Unavailable"} mono />
        <Detail label="Tokens" value={tokens(session)} />
        <Detail
          label="Est. cost"
          value={
            session.estimatedCostUsd === null
              ? "Unavailable"
              : `$${session.estimatedCostUsd.toFixed(2)}`
          }
        />
        <Detail label="Model" value={session.model ?? "Unavailable"} wide />
      </div>
      <div className="activity-heading">
        <span className="eyebrow">Activity</span>
        <span>{events.length} events</span>
      </div>
      <div className="activity-list">
        {events.length ? (
          events.map((event) => <ActivityRow key={event.id} event={event} />)
        ) : (
          <p>No normalized activity events are available for this session.</p>
        )}
      </div>
    </aside>
  );
}

function Detail({
  label,
  value,
  mono,
  wide,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "detail-wide" : ""}>
      <span className="eyebrow">{label}</span>
      <strong className={mono ? "mono" : ""}>{value}</strong>
    </div>
  );
}

function ActivityRow({ event }: { event: SessionEventRow }) {
  const icons: Record<string, ReactNode> = {
    started: <CircleDot size={14} />,
    tool: <Command size={14} />,
    file: <FileCode2 size={14} />,
    command: <TerminalSquare size={14} />,
    completed: <Check size={14} />,
    warning: <AlertTriangle size={14} />,
    info: <Code2 size={14} />,
  };
  return (
    <article className="activity-row">
      <div className="event-icon">
        {icons[event.kind] ?? <Clock3 size={14} />}
      </div>
      <div>
        <strong>{event.title}</strong>
        {event.detail && <p>{event.detail}</p>}
      </div>
      <time>
        {new Date(event.occurredAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </time>
    </article>
  );
}
