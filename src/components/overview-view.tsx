"use client";

import {
  AlertTriangle,
  CircleDot,
  Clock3,
  FolderKanban,
  LayoutDashboard,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect } from "react";
import {
  absoluteTime,
  elapsed,
  formatCostUsd,
  formatTokens,
  relativeTime,
  runtime,
} from "@/lib/format";
import { providerLabels, statusLabels } from "@/lib/labels";
import type {
  OverviewData,
  OverviewPatterns,
  ProjectSummary,
  SessionListItem,
} from "@/lib/queries";

interface OverviewViewProps {
  overview: OverviewData;
  patterns: OverviewPatterns;
  running: SessionListItem[];
  attention: SessionListItem[];
  recentProjects: ProjectSummary[];
}

function level(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.max(1, Math.round((value / max) * 10));
}

export function OverviewView({
  overview,
  patterns,
  running,
  attention,
  recentProjects,
}: OverviewViewProps) {
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [router]);

  return (
    <section className="relay-content">
      <header className="page-header">
        <div>
          <h1>Overview</h1>
          <p>Today and the last seven days across every agent.</p>
        </div>
      </header>

      <div className="summary-grid" aria-label="Daily and weekly summary">
        <Link className="metric metric-link" href="/sessions?range=today">
          <span className="eyebrow">Sessions today</span>
          <strong>{overview.today.sessions}</strong>
          <span>{overview.today.events} activity events</span>
        </Link>
        <Link className="metric metric-link" href="/sessions?status=running">
          <span className="eyebrow">Running now</span>
          <strong>{running.length}</strong>
          <span className={running.length ? "metric-accent" : ""}>
            {running.length > 0 && <CircleDot size={10} />}
            {running.length ? "Live from local files" : "Nothing in flight"}
          </span>
        </Link>
        <Link className="metric metric-link" href="/sessions">
          <span className="eyebrow">Sessions this week</span>
          <strong>{overview.week.sessions}</strong>
          <span>{runtime(overview.week.runtimeMs)} total runtime</span>
        </Link>
        <Link className="metric metric-link" href="/sessions?status=attention">
          <span className="eyebrow">Failures this week</span>
          <strong>{overview.week.failures}</strong>
          <span>Interrupted or needing attention</span>
        </Link>
      </div>

      <div className="overview-grid">
        <div className="overview-column">
          <ActivityHeatmap cells={patterns.heatmap} />
          <SessionLength length={patterns.length} />
          <CostAtAGlance cost={patterns.costWeek} />
        </div>

        <div className="overview-column">
          <section className="card overview-card" aria-label="Running now">
            <div className="overview-card-head">
              <h3>Running now</h3>
              <Link href="/sessions?status=running">View all</Link>
            </div>
            {running.length ? (
              running.map((session) => (
                <SessionLine key={session.id} session={session} />
              ))
            ) : (
              <p className="overview-empty">
                No sessions are currently active.
              </p>
            )}
          </section>
          <section className="card overview-card" aria-label="Needs attention">
            <div className="overview-card-head">
              <h3>
                <AlertTriangle size={14} className="inline-icon" /> Needs
                attention
              </h3>
              <Link href="/sessions?status=attention">View all</Link>
            </div>
            {attention.length ? (
              attention.map((session) => (
                <SessionLine key={session.id} session={session} />
              ))
            ) : (
              <p className="overview-empty">
                Nothing needs attention in the last day.
              </p>
            )}
          </section>
          <section className="card overview-card" aria-label="Recent projects">
            <div className="overview-card-head">
              <h3>
                <FolderKanban size={14} className="inline-icon" /> Recent
                projects
              </h3>
              <Link href="/sessions?view=projects">View all</Link>
            </div>
            {recentProjects.map((project) => (
              <Link
                key={project.key}
                className="project-session-row"
                href="/sessions?view=projects"
              >
                <span aria-hidden>
                  <LayoutDashboard size={13} />
                </span>
                <div>
                  <strong>{project.repository ?? "Unknown workspace"}</strong>
                  <p>
                    {project.sessionCount} sessions ·{" "}
                    {runtime(project.totalRuntimeMs)}
                  </p>
                </div>
                <time title={absoluteTime(project.lastActivityAt)}>
                  {relativeTime(project.lastActivityAt)}
                </time>
              </Link>
            ))}
          </section>
        </div>
      </div>
    </section>
  );
}

function SessionLine({ session }: { session: SessionListItem }) {
  return (
    <Link className="project-session-row" href={`/sessions/${session.id}`}>
      <span className={`status-label status-${session.status}`}>
        <i />
      </span>
      <div>
        <strong>{session.title}</strong>
        <p>
          {providerLabels[session.provider]} · {statusLabels[session.status]} ·{" "}
          {elapsed(session.startedAt, session.endedAt ?? session.updatedAt)} ·{" "}
          {session.repository ?? "Unknown workspace"}
        </p>
      </div>
      <time title={absoluteTime(session.updatedAt)}>
        {relativeTime(session.updatedAt)}
      </time>
    </Link>
  );
}

function ActivityHeatmap({ cells }: { cells: OverviewPatterns["heatmap"] }) {
  const maxCount = Math.max(1, ...cells.map((cell) => cell.count));
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  // cells[] is in day-major order (dayOfWeek*24 + hour) from the query.
  const hourLabel = (hour: number) =>
    hour % 3 === 0
      ? hour === 0
        ? "12a"
        : hour < 12
          ? `${hour}a`
          : hour === 12
            ? "12p"
            : `${hour - 12}p`
      : "";
  return (
    <section className="card overview-card" aria-label="Activity heatmap">
      <div className="overview-card-head">
        <h3>When you&apos;re active</h3>
        <span>last 30 days</span>
      </div>
      <div className="heatmap" role="img" aria-label="Sessions by day and hour">
        <span aria-hidden />
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={`h${hour}`} className="heat-hour-label">
            {hourLabel(hour)}
          </span>
        ))}
        {days.map((day, dayIndex) => (
          <Fragment key={day}>
            <span className="heat-day-label">{day}</span>
            {Array.from({ length: 24 }, (_, hour) => {
              const cell = cells[dayIndex * 24 + hour];
              return (
                <span
                  key={`${dayIndex}-${hour}`}
                  className={`heat-cell heat-fill-${level(cell.count, maxCount)}`}
                  title={`${day} ${hour}:00 — ${cell.count} sessions`}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
    </section>
  );
}

function SessionLength({ length }: { length: OverviewPatterns["length"] }) {
  const maxBucket = Math.max(
    1,
    ...length.buckets.map((bucket) => bucket.count),
  );
  return (
    <section className="card overview-card" aria-label="Session length">
      <div className="overview-card-head">
        <h3>
          <Clock3 size={14} className="inline-icon" /> Session length
        </h3>
        <span>last 7 days · {length.sessionCount} sessions</span>
      </div>
      <div className="hist-list">
        {length.buckets.map((bucket) => (
          <div
            key={bucket.label}
            className="hist-row"
            title={`${bucket.count} sessions`}
          >
            <span className="hist-label">{bucket.label}</span>
            <span className="meter" aria-hidden>
              <i className={`meter-fill-${level(bucket.count, maxBucket)}`} />
            </span>
            <span className="mono">{bucket.count}</span>
          </div>
        ))}
      </div>
      {length.medianMs !== null && length.longestMs !== null && (
        <p className="hist-footnote">
          Median <strong>{runtime(length.medianMs)}</strong> · longest{" "}
          <strong>{runtime(length.longestMs)}</strong>
          {length.longTailShare !== null && length.longTailShare > 0 && (
            <>
              {" · "}
              sessions over 30 min hold{" "}
              <strong>{Math.round(length.longTailShare * 100)}%</strong> of
              runtime
            </>
          )}
        </p>
      )}
    </section>
  );
}

function CostAtAGlance({ cost }: { cost: OverviewPatterns["costWeek"] }) {
  const maxModel = Math.max(1, ...cost.topModels.map((model) => model.costUsd));
  return (
    <section className="card overview-card" aria-label="Cost this week">
      <div className="overview-card-head">
        <h3>Cost this week</h3>
        <Link href="/usage">Full breakdown →</Link>
      </div>
      <div className="cost-total">
        <strong className="mono">
          {cost.costUsd === null ? "—" : formatCostUsd(cost.costUsd)}
        </strong>
        <span>
          {cost.costUsd === null
            ? `Unavailable · ${formatTokens(cost.tokens)}`
            : `estimated · ${formatTokens(cost.tokens)}`}
        </span>
      </div>
      {cost.topModels.length > 0 &&
        cost.topModels.map((model) => (
          <div
            key={model.model}
            className="cost-row"
            title={`${model.model}: ${formatCostUsd(model.costUsd)}`}
          >
            <span className="cost-label mono">{model.model}</span>
            <span className="meter" aria-hidden>
              <i className={`meter-fill-${level(model.costUsd, maxModel)}`} />
            </span>
            <span className="mono">{formatCostUsd(model.costUsd)}</span>
          </div>
        ))}
    </section>
  );
}
