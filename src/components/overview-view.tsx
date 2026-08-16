"use client";

import {
  AlertTriangle,
  ArrowRight,
  Circle,
  CircleDot,
  Clock3,
  FolderKanban,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect } from "react";
import {
  absoluteTime,
  elapsed,
  formatCostUsd,
  formatTokens,
  hasMeaningfulDuration,
  level,
  relativeTime,
  runtime,
} from "@/lib/format";
import { DASHBOARD_REFRESH_INTERVAL_MS } from "@/lib/polling";
import { providerLabels, rangeDaysLabel, statusDisplay } from "@/lib/labels";
import type {
  OverviewData,
  OverviewPatterns,
  OverviewRange,
  ProjectSummary,
  SessionListItem,
} from "@/lib/queries";
import { Meter } from "./charts";
import { RangeSwitcher } from "./range-switcher";

interface OverviewViewProps {
  range: OverviewRange;
  overview: OverviewData;
  patterns: OverviewPatterns;
  running: SessionListItem[];
  attention: SessionListItem[];
  recentProjects: ProjectSummary[];
}

export function OverviewView({
  range,
  overview,
  patterns,
  running,
  attention,
  recentProjects,
}: OverviewViewProps) {
  const router = useRouter();

  // The summary label follows the active range: "this week" at the default
  // 7-day view, "last 30 days" when widened. The toggle defaults to 7d, so an
  // absent param is treated as 7d rather than persisted.
  const rangeLabel =
    range === "7d"
      ? "this week"
      : range === "30d"
        ? "last 30 days"
        : "all time";
  const daysLabel = rangeDaysLabel(range);
  const trailingRangeLabel = range === "all" ? "all time" : `last ${daysLabel}`;

  useEffect(() => {
    const timer = window.setInterval(
      () => router.refresh(),
      DASHBOARD_REFRESH_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [router]);

  return (
    <section className="relay-content">
      <header className="page-header">
        <div>
          <h1>Overview</h1>
          <p>
            {range === "7d"
              ? "Today and the last seven days across every agent."
              : range === "30d"
                ? "Today and the last thirty days across every agent."
                : "Today and all recorded sessions across every agent."}
          </p>
        </div>
        <RangeSwitcher range={range} ariaLabel="Overview range" />
      </header>

      <div className="summary-grid" aria-label="Daily and weekly summary">
        <Link
          className="metric metric-link"
          href={range === "7d" ? "/sessions" : `/sessions?range=${range}`}
        >
          <span className="eyebrow">{`Sessions ${rangeLabel}`}</span>
          <strong>{overview.week.sessions}</strong>
          <span>{runtime(overview.week.runtimeMs)} total runtime</span>
        </Link>
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
        <Link
          className="metric metric-link"
          href={range === "7d" ? "/usage" : `/usage?range=${range}`}
        >
          <span className="eyebrow">{`Cost ${rangeLabel}`}</span>
          <strong className="mono">
            {patterns.costWeek.costUsd === null
              ? "—"
              : formatCostUsd(patterns.costWeek.costUsd)}
          </strong>
          <span>
            {patterns.costWeek.costUsd === null
              ? `Unavailable · ${formatTokens(patterns.costWeek.tokens)}`
              : `estimated · ${formatTokens(patterns.costWeek.tokens)}`}
          </span>
        </Link>
      </div>

      <div className="overview-grid">
        <div className="overview-column">
          <ActivityHeatmap cells={patterns.heatmap} />
          <SessionLength
            length={patterns.length}
            rangeLabel={trailingRangeLabel}
          />
          <CostAtAGlance
            cost={patterns.costWeek}
            range={range}
            rangeLabel={rangeLabel}
          />
        </div>

        <div className="overview-column">
          <section className="card overview-card" aria-label="Running now">
            <div className="overview-card-head">
              <h3 className="overview-card-title">
                <CircleDot
                  aria-hidden="true"
                  className="running-icon"
                  size={14}
                />
                Running now
              </h3>
              <Link href="/sessions?status=running">View all</Link>
            </div>
            {running.length ? (
              running.map((session) => (
                <SessionLine key={session.id} session={session} hideStatus />
              ))
            ) : (
              <p className="overview-empty">
                No sessions are currently active.
              </p>
            )}
          </section>
          <section className="card overview-card" aria-label="Needs attention">
            <div className="overview-card-head">
              <h3 className="overview-card-title">
                <AlertTriangle
                  aria-hidden="true"
                  className="warning-icon"
                  size={14}
                />
                Needs attention
              </h3>
              <Link href="/sessions?status=attention">View all</Link>
            </div>
            {attention.length ? (
              attention.map((session) => (
                <SessionLine key={session.id} session={session} />
              ))
            ) : (
              <p className="overview-empty">
                Nothing needs attention in the past 3 days.
              </p>
            )}
          </section>
          <section className="card overview-card" aria-label="Recent projects">
            <div className="overview-card-head">
              <h3 className="overview-card-title">
                <FolderKanban aria-hidden="true" size={14} />
                Recent projects
              </h3>
              <Link href="/sessions?view=projects">View all</Link>
            </div>
            {recentProjects.map((project) => (
              <Link
                key={project.key}
                className="project-session-row recent-project-row"
                href={`/sessions?project=${encodeURIComponent(project.key)}`}
              >
                <span className="project-list-marker" aria-hidden />
                <div className="min-w-0">
                  <p>{project.repository ?? "Unknown workspace"}</p>
                  <p className="text-muted-foreground text-xs">
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

function SessionLine({
  session,
  hideStatus = false,
}: {
  session: SessionListItem;
  hideStatus?: boolean;
}) {
  return (
    <Link
      className="project-session-row session-line-row"
      href={`/sessions/${session.id}`}
    >
      <span
        className={`status-label status-${session.status} session-line-status`}
      >
        <Circle aria-hidden="true" fill="currentColor" size={6} />
      </span>
      <div className="min-w-0">
        <p>{session.title}</p>
        <p className="text-muted-foreground text-xs">
          {[
            providerLabels[session.provider],
            hideStatus
              ? null
              : statusDisplay(session.status, session.statusReason),
            // Only completed/running (and awaiting-input) durations reflect
            // real work; failed/interrupted/incomplete spans are omitted.
            hasMeaningfulDuration(session.status)
              ? elapsed(session.startedAt, session.endedAt ?? session.updatedAt)
              : null,
            session.repository ?? "Unknown workspace",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <time title={absoluteTime(session.updatedAt)}>
        {relativeTime(session.updatedAt)}
      </time>
    </Link>
  );
}

// Formats a YYYY-MM-DD cell key as e.g. "Jul 13". The key is already a local
// calendar date, so it is parsed and formatted in UTC to avoid re-shifting.
function heatDayLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// 3-hour time-of-day rows; index matches the query's `band` (0 = midnight).
const HEAT_BAND_LABELS = ["12a", "3a", "6a", "9a", "12p", "3p", "6p", "9p"];
const HEAT_BAND_RANGES = [
  "12–3 AM",
  "3–6 AM",
  "6–9 AM",
  "9 AM–12 PM",
  "12–3 PM",
  "3–6 PM",
  "6–9 PM",
  "9 PM–12 AM",
];

function ActivityHeatmap({ cells }: { cells: OverviewPatterns["heatmap"] }) {
  const maxCount = Math.max(1, ...cells.map((cell) => cell.count));
  const bands = HEAT_BAND_LABELS.length;
  // cells[] is day-major (all bands of the oldest day first). Lay it out with
  // one column per actual day and one row per time-of-day band.
  const days = cells
    .filter((_, index) => index % bands === 0)
    .map((cell) => cell.day);
  const first = days[0];
  const last = days.at(-1);
  // The heatmap always spans 30 days; label every 5th so the x-axis stays
  // readable.
  const labelStep = 5;
  return (
    <section className="card overview-card" aria-label="Activity heatmap">
      <div className="overview-card-head">
        <h3>When you&apos;re active</h3>
        <span>
          {first && last
            ? `${heatDayLabel(first)} – ${heatDayLabel(last)}`
            : ""}
        </span>
      </div>
      <div
        className="heatmap-cal"
        role="img"
        aria-label="Sessions by day and time of day over the last 30 days"
      >
        {HEAT_BAND_LABELS.map((label, band) => (
          <Fragment key={label}>
            <span className="heat-band-label">{label}</span>
            {days.map((day, dayIndex) => {
              const cell = cells[dayIndex * bands + band];
              return (
                <span
                  key={`${day}-${band}`}
                  className={`heat-cell heat-fill-${level(cell.count, maxCount)}`}
                  title={`${heatDayLabel(day)} · ${HEAT_BAND_RANGES[band]} — ${cell.count} session${cell.count === 1 ? "" : "s"}`}
                />
              );
            })}
          </Fragment>
        ))}
        <span aria-hidden />
        {days.map((day, dayIndex) => (
          <span key={`label-${day}`} className="heat-date-label">
            {dayIndex % labelStep === 0 ? heatDayLabel(day) : ""}
          </span>
        ))}
      </div>
    </section>
  );
}

function SessionLength({
  length,
  rangeLabel,
}: {
  length: OverviewPatterns["length"];
  rangeLabel: string;
}) {
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
        <span>{`${rangeLabel} · ${length.sessionCount} sessions`}</span>
      </div>
      <div className="grid gap-2">
        {length.buckets.map((bucket) => (
          <div
            key={bucket.label}
            className="hist-row"
            title={`${bucket.count} sessions`}
          >
            <span className="text-muted-foreground text-xs">
              {bucket.label}
            </span>
            <Meter value={bucket.count} max={maxBucket} />
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

function CostAtAGlance({
  cost,
  range,
  rangeLabel,
}: {
  cost: OverviewPatterns["costWeek"];
  range: OverviewRange;
  rangeLabel: string;
}) {
  const maxModel = Math.max(1, ...cost.topModels.map((model) => model.costUsd));
  return (
    <section className="card overview-card" aria-label={`Cost ${rangeLabel}`}>
      <div className="overview-card-head">
        <h3>{`Cost ${rangeLabel}`}</h3>
        <Link href={range === "7d" ? "/usage" : `/usage?range=${range}`}>
          Full breakdown{" "}
          <ArrowRight aria-hidden="true" className="inline-icon" size={12} />
        </Link>
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
            <Meter value={model.costUsd} max={maxModel} />
            <span className="mono">{formatCostUsd(model.costUsd)}</span>
          </div>
        ))}
    </section>
  );
}
