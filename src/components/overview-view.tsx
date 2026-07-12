"use client";

import {
  AlertTriangle,
  CircleDot,
  FolderKanban,
  LayoutDashboard,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { elapsed, relativeTime, runtime } from "@/lib/format";
import { providerBadges, providerLabels, statusLabels } from "@/lib/labels";
import type {
  OverviewData,
  ProjectSummary,
  SessionListItem,
} from "@/lib/queries";

interface OverviewViewProps {
  overview: OverviewData;
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
  running,
  attention,
  recentProjects,
}: OverviewViewProps) {
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [router]);

  const maxProvider = Math.max(
    1,
    ...overview.providerCounts.map((entry) => entry.count),
  );
  const maxDaily = Math.max(1, ...overview.daily.map((entry) => entry.count));

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
        <Link
          className="metric metric-link"
          href="/sessions?status=interrupted"
        >
          <span className="eyebrow">Failures this week</span>
          <strong>{overview.week.failures}</strong>
          <span>Interrupted or needing attention</span>
        </Link>
      </div>

      <div className="overview-grid">
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
              <Link href="/sessions?status=interrupted">View all</Link>
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
        </div>

        <div className="overview-column">
          <section className="card overview-card" aria-label="Agent usage">
            <div className="overview-card-head">
              <h3>Agents this week</h3>
            </div>
            {overview.providerCounts.length ? (
              overview.providerCounts.map((entry) => (
                <Link
                  key={entry.provider}
                  className="dist-row"
                  href={`/sessions?provider=${entry.provider}`}
                >
                  <span className={`badge ${providerBadges[entry.provider]}`}>
                    {providerLabels[entry.provider]}
                  </span>
                  <span className="meter" aria-hidden>
                    <i
                      className={`meter-fill-${level(entry.count, maxProvider)}`}
                    />
                  </span>
                  <span className="mono">{entry.count}</span>
                </Link>
              ))
            ) : (
              <p className="overview-empty">No sessions this week.</p>
            )}
          </section>

          <section
            className="card overview-card"
            aria-label="Daily session activity"
          >
            <div className="overview-card-head">
              <h3>Last 14 days</h3>
              <span>
                {overview.daily.reduce((a, d) => a + d.count, 0)} sessions
              </span>
            </div>
            <div className="spark" role="img" aria-label="Sessions per day">
              {overview.daily.map((day) => (
                <span
                  key={day.date}
                  className="spark-slot"
                  title={`${day.date}: ${day.count} sessions`}
                >
                  <i className={`spark-fill-${level(day.count, maxDaily)}`} />
                </span>
              ))}
            </div>
          </section>

          <section className="card overview-card" aria-label="Recent projects">
            <div className="overview-card-head">
              <h3>
                <FolderKanban size={14} className="inline-icon" /> Recent
                projects
              </h3>
              <Link href="/projects">View all</Link>
            </div>
            {recentProjects.map((project) => (
              <Link
                key={project.key}
                className="project-session-row"
                href={`/projects?selected=${encodeURIComponent(project.key)}`}
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
                <time>{relativeTime(project.lastActivityAt)}</time>
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
    <Link
      className="project-session-row"
      href={`/sessions?range=all&selected=${session.id}`}
    >
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
      <time>{relativeTime(session.updatedAt)}</time>
    </Link>
  );
}
