"use client";

import {
  AlertTriangle,
  ChevronDown,
  Database,
  FolderKanban,
  LoaderCircle,
  RefreshCw,
  Search,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { formatCostUsd, relativeTime, runtime } from "@/lib/format";
import { providerLabels, statusLabels } from "@/lib/labels";
import type {
  ModelOption,
  OverviewRange,
  ProjectOption,
  ProjectCostSummary,
  SessionFilters,
  SessionTreeItem,
  UsageWindow,
} from "@/lib/queries";
import { Metric } from "./metric";
import { ProjectsTable } from "./projects-table";
import { RangeSwitcher } from "./range-switcher";
import { sessionCount, SessionsTable } from "./sessions-table";
import { useDashboardPolling } from "./use-dashboard-polling";

export type WorkspaceView = "sessions" | "projects";

interface DashboardProps {
  sessions: SessionTreeItem[];
  projects: ProjectCostSummary[];
  projectOptions: ProjectOption[];
  modelOptions: ModelOption[];
  summary: {
    sessionsToday: number;
    activeNow: number;
    totalRuntimeMs: number;
    connectedAgents: number;
  };
  syncState: { lastSyncedAt: string | null; errors: number; sources: number };
  costToday: UsageWindow;
  filters: SessionFilters;
  range?: OverviewRange;
  isTodayRange?: boolean;
  view: WorkspaceView;
}

export function Dashboard({
  sessions,
  projects,
  projectOptions,
  modelOptions,
  summary,
  syncState,
  costToday,
  filters,
  range = "7d",
  isTodayRange = false,
  view,
}: DashboardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(filters.q ?? "");
  const [isSyncing, setIsSyncing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  useDashboardPolling();

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
      (name === "sort" && value === "updated") ||
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
    <section className="agentarium-content">
      <header className="page-header sessions-page-header">
        <div>
          <h1>Sessions</h1>
          <p>
            Browse individual sessions and project-level rollups in one place
          </p>
        </div>
        <div className="page-header-actions">
          {isTodayRange && (
            <span className="badge border border-border bg-card text-foreground">
              Showing today
            </span>
          )}
          <RangeSwitcher
            range={isTodayRange ? null : range}
            ariaLabel="Sessions range"
          />
          <button
            className="btn btn-outline sync-button"
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
        </div>
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

      <div className="filter-row session-filter-row">
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
          label="Filter by project"
          value={filters.project ?? "all"}
          onChange={(value) => updateParam("project", value)}
          options={[
            { value: "all", label: "All projects" },
            ...projectOptions.map((option) => ({
              value: option.key,
              label: `${option.label} (${option.sessionCount})`,
            })),
          ]}
        />
        <FilterSelect
          label="Filter by model"
          value={filters.model ?? "all"}
          onChange={(value) => updateParam("model", value)}
          options={[
            { value: "all", label: "All models" },
            ...modelOptions.map((option) => ({
              value: option.value,
              label: `${option.label} (${option.sessionCount})`,
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
          label="Sort sessions"
          value={filters.sort ?? "updated"}
          onChange={(value) => updateParam("sort", value)}
          options={[
            { value: "updated", label: "Last updated" },
            { value: "started", label: "Newest started" },
            { value: "duration", label: "Longest first" },
            { value: "cost", label: "Costliest first" },
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
          <ProjectsTable projects={projects} />
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
