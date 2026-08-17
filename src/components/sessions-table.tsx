"use client";

import { ChevronDown, Database, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  absoluteTime,
  countLabel,
  elapsed,
  formatCostUsd,
  hasMeaningfulDuration,
  relativeTime,
} from "@/lib/format";
import { normalizeModel } from "@/lib/pricing";
import type { SessionFilters, SessionTreeItem } from "@/lib/queries";
import { ProviderBadge } from "./provider-badge";
import { StatusLabel } from "./status-label";

export function sessionCount(sessions: SessionTreeItem[]): number {
  return sessions.reduce(
    (total, session) => total + 1 + sessionCount(session.children),
    0,
  );
}

export function SessionsTable({
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
        <span>Updated</span>
        <span>Duration</span>
        <span>Model</span>
        <span title="Includes the cost of any subagents the session spawned">
          Cost
        </span>
      </div>
      {sessions.length ? (
        sessions.map((session) => (
          <SessionRow key={session.id} session={session} depth={0} />
        ))
      ) : (
        <EmptyState
          hasFilters={Boolean(
            filters.q ||
            filters.provider ||
            filters.status ||
            filters.project ||
            filters.model,
          )}
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
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <div className={depth ? "session-row session-child-row" : "session-row"}>
        <div className="session-primary">
          <div className="session-title-actions">
            <Link href={`/sessions/${session.id}`}>{session.title}</Link>
          </div>
          <span className="mono session-meta">
            <span className="session-meta-text">
              {session.sessionKind === "subagent"
                ? `Subagent${session.agentLabel ? ` · ${session.agentLabel}` : ""}`
                : (session.repository ?? "Unknown workspace")}
            </span>
            {session.children.length > 0 && (
              <button
                className="subagent-toggle"
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={expanded}
              >
                <ChevronDown
                  size={12}
                  className={expanded ? "" : "chevron-collapsed"}
                />
                {countLabel(session.children.length, "subagent")}
              </button>
            )}
          </span>
        </div>
        <div>
          <ProviderBadge provider={session.provider} />
        </div>
        <StatusLabel status={session.status} reason={session.statusReason} />
        <span
          className="mono session-secondary"
          title={absoluteTime(session.startedAt)}
        >
          {relativeTime(session.startedAt)}
        </span>
        <span
          className="mono session-secondary"
          title={absoluteTime(session.updatedAt)}
        >
          {relativeTime(session.updatedAt)}
        </span>
        <span className="mono session-secondary text-foreground">
          {hasMeaningfulDuration(session.status)
            ? elapsed(session.startedAt, session.endedAt ?? session.updatedAt)
            : "—"}
        </span>
        <span
          className="mono session-secondary"
          title={session.model ?? undefined}
        >
          {session.model ? normalizeModel(session.model) : "—"}
        </span>
        <span className="mono session-secondary text-foreground">
          {session.costUsd != null ? formatCostUsd(session.costUsd) : "—"}
        </span>
      </div>
      {expanded &&
        session.children.map((child) => (
          <SessionRow key={child.id} session={child} depth={depth + 1} />
        ))}
    </>
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
          : "Import local agent activity to populate Agentarium."}
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
