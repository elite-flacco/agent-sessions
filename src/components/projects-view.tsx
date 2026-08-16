import { ArrowLeft, CircleDot, FolderKanban, GitBranch } from "lucide-react";
import Link from "next/link";
import {
  absoluteTime,
  formatCostUsd,
  relativeTime,
  runtime,
  shortenHomePath,
} from "@/lib/format";
import {
  providerBadges,
  providerLabels,
  rangeDaysLabel,
  statusDisplay,
} from "@/lib/labels";
import type {
  ProjectActivity,
  ProjectDetail,
  ProjectState,
  ProjectSummary,
} from "@/lib/queries";
import { Sparkline } from "./charts";
import { RangeSwitcher } from "./range-switcher";

interface ProjectsViewProps {
  projects: ProjectSummary[];
  selected: ProjectDetail | null;
}

const stateLabels: Record<ProjectState, string> = {
  active: "Active",
  waiting: "Waiting on you",
  blocked: "Blocked",
  complete: "Idle",
};

export function ProjectsView({ projects, selected }: ProjectsViewProps) {
  if (selected) return <ProjectBriefing detail={selected} />;
  return <ProjectsLanding projects={projects} />;
}

function ProjectsLanding({ projects }: { projects: ProjectSummary[] }) {
  return (
    <section className="relay-content projects-page">
      <header className="projects-header">
        <div>
          <h1>Projects</h1>
          <p>All your projects at a glance.</p>
        </div>
      </header>
      {projects.length ? (
        <div className="projects-grid" aria-label="Projects with Git evidence">
          {projects.map((project) => (
            <Link
              key={project.key}
              className="project-card card"
              href={`/projects?project=${encodeURIComponent(project.key)}`}
            >
              <div>
                <div className="project-card-title">
                  <FolderKanban size={17} />
                  <h4>{project.repository}</h4>
                  {project.activeCount > 0 && <CircleDot size={13} />}
                </div>
                <p className="text-muted-foreground text-xs">
                  {project.sessionCount} sessions ·{" "}
                  {runtime(project.totalRuntimeMs)}
                </p>
                <div className="project-provider-list">
                  {project.providers.map((provider) => (
                    <span
                      key={provider}
                      className={`badge ${providerBadges[provider]}`}
                    >
                      {providerLabels[provider]}
                    </span>
                  ))}
                </div>
              </div>
              <div className="text-muted-foreground text-xs">
                Updated {relativeTime(project.lastActivityAt)}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state card">
          <FolderKanban size={24} />
          <h2>No projects with local Git evidence yet</h2>
          <p>
            Relay keeps one-off sessions separate until a repository
            relationship can be established safely.
          </p>
          <Link className="btn btn-outline" href="/sessions">
            Browse sessions
          </Link>
        </div>
      )}
    </section>
  );
}

function ProjectBriefing({ detail }: { detail: ProjectDetail }) {
  const { project } = detail;
  const windowLabel = `last ${rangeDaysLabel(detail.range)}`;
  return (
    <section className="relay-content projects-page">
      <Link className="back-link" href="/projects">
        <ArrowLeft size={14} />
        All projects
      </Link>
      <header className="projects-header project-briefing-header">
        <div>
          <span className="eyebrow">Project briefing</span>
          <h1>{project.repository}</h1>
          <p>
            Current focus:{" "}
            {detail.currentFocus?.title ?? "No session title available"}
          </p>
        </div>
        <div className="project-header-controls">
          <span className={`project-state project-state-${detail.state}`}>
            <CircleDot size={13} />
            {stateLabels[detail.state]}
          </span>
          <RangeSwitcher range={detail.range} ariaLabel="Project range" />
        </div>
      </header>

      <div className="summary-grid project-metrics" aria-label="Project rollup">
        <Metric
          label="Sessions"
          value={String(detail.windowSessionCount)}
          note={`of ${project.sessionCount} all time`}
        />
        <Metric
          label="Elapsed time"
          value={runtime(detail.windowRuntimeMs)}
          note={`Recorded session time`}
        />
        <Metric
          label="Cost"
          value={formatCostUsd(detail.totalCostUsd)}
          note={
            detail.unpricedSessionCount
              ? `${detail.unpricedSessionCount} unpriced sessions excluded`
              : `Complete local pricing`
          }
        />
        <Metric
          label="Most expensive session"
          textual
          value={detail.largestCostSession?.title ?? "None priced"}
          note={
            detail.largestCostSession?.costUsd != null
              ? `${formatCostUsd(detail.largestCostSession.costUsd)} · incl. subagents`
              : "No priced session in range"
          }
        />
      </div>

      <ProjectSpendCard detail={detail} />

      <div className="project-briefing-grid items-stretch">
        <section
          className="card project-briefing-card"
          aria-labelledby="changes-title"
        >
          <span className="eyebrow">What changed recently</span>
          <h2 id="changes-title">Recent activity</h2>
          {detail.activity.length ? (
            <ol className="project-timeline">
              {detail.activity.map((event) => (
                <li key={event.sessionId}>
                  <span className="project-list-marker" aria-hidden />
                  <div>
                    <Link href={`/sessions/${event.sessionId}`}>
                      <strong>
                        {event.sessionTitle ?? "Untitled session"}
                      </strong>
                    </Link>
                    <p>
                      {providerLabels[event.provider]} ·{" "}
                      {activityLabels[event.kind]}
                    </p>
                  </div>
                  <time title={absoluteTime(event.occurredAt)}>
                    {relativeTime(event.occurredAt)}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <p className="project-muted">
              No retained start, file, check, or completion events in the{" "}
              {windowLabel}.
            </p>
          )}
        </section>

        <section
          className="card project-briefing-card"
          aria-labelledby="attention-title"
        >
          <span className="eyebrow">Needs attention</span>
          <h2 id="attention-title">Actionable session evidence</h2>
          {detail.attention.length ? (
            <ul className="project-attention-list">
              {detail.attention.map((session) => (
                <li key={session.id}>
                  <Link href={`/sessions/${session.id}`}>{session.title}</Link>
                  <span className={`status-label status-${session.status}`}>
                    <i />
                    {statusDisplay(session.status, session.statusReason)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="project-muted">
              No sessions currently report waiting input, failure, or
              interruption.
            </p>
          )}
        </section>
      </div>

      <section
        className="card project-evidence"
        aria-labelledby="context-title"
      >
        <span className="eyebrow">Established local context</span>
        <h2 id="context-title">Branches and worktrees</h2>
        {detail.worktrees.length ? (
          <ul className="project-worktree-list">
            {detail.worktrees.map((worktree) => (
              <li key={worktree.workdir}>
                <GitBranch size={15} />
                <div>
                  <strong>
                    {worktree.branches.join(", ") || "No branch recorded"}
                  </strong>
                  <code title={worktree.workdir}>
                    {shortenHomePath(worktree.workdir)}
                  </code>
                </div>
                <time title={absoluteTime(worktree.lastActivityAt)}>
                  {worktree.sessionCount} sessions ·{" "}
                  {relativeTime(worktree.lastActivityAt)}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="project-muted">No local working directory recorded.</p>
        )}
      </section>
    </section>
  );
}

const activityLabels: Record<ProjectActivity["kind"], string> = {
  started: "Run started",
  file: "Files changed",
  command: "Command run",
  completed: "Run completed",
};

/**
 * Daily spend across the selected range. The single total answers "how much",
 * the trend answers "is this getting more expensive" — which the total alone
 * cannot, and which is the question a project owner actually asks.
 */
function ProjectSpendCard({ detail }: { detail: ProjectDetail }) {
  const peak = detail.costTrend.reduce(
    (max, day) => (day.costUsd > max ? day.costUsd : max),
    0,
  );
  return (
    <div className="project-briefing-grid items-stretch">
      <section
        className="card project-briefing-card flex flex-col"
        aria-label="Spend trend"
      >
        <span className="eyebrow">Spend over time</span>
        <h2>Daily cost</h2>
        {peak > 0 ? (
          <>
            <Sparkline
              className="project-spark grow"
              values={detail.costTrend.map((day) => day.costUsd)}
              label={`Daily cost`}
              slotTitle={(index) =>
                `${detail.costTrend[index].date} · ${formatCostUsd(
                  detail.costTrend[index].costUsd,
                )}`
              }
            />
            <p className="project-muted mt-2">
              Peak day {formatCostUsd(peak)}
              {detail.unpricedSessionCount
                ? ` · ${detail.unpricedSessionCount} unpriced sessions excluded`
                : ""}
            </p>
          </>
        ) : (
          <p className="project-muted">No priced spend in this range.</p>
        )}
      </section>

      <section
        className="card project-briefing-card"
        aria-label="Provider split"
      >
        <span className="eyebrow">Who did the work</span>
        <h2>Sessions by agent</h2>
        {detail.byProvider.length ? (
          <ul className="project-provider-split">
            {detail.byProvider.map((row) => (
              <li key={row.provider}>
                <span className={`badge ${providerBadges[row.provider]}`}>
                  {providerLabels[row.provider]}
                </span>
                <p>{row.sessionCount} sessions</p>
                <span
                  title={
                    row.unpricedSessionCount
                      ? `${row.unpricedSessionCount} unpriced sessions excluded`
                      : undefined
                  }
                >
                  {formatCostUsd(row.costUsd)}
                  {row.unpricedSessionCount ? "*" : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="project-muted">No sessions in this range.</p>
        )}
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  note,
  /** Set when the value is prose rather than a figure, so it steps down a size. */
  textual,
}: {
  label: string;
  value: string;
  note?: string;
  textual?: boolean;
}) {
  return (
    <div className={textual ? "metric metric-textual" : "metric"}>
      <span className="eyebrow">{label}</span>
      <strong title={textual ? value : undefined}>{value}</strong>
      {note && <span>{note}</span>}
    </div>
  );
}
