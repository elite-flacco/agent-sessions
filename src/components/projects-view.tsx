import {
  ArrowLeft,
  CircleDot,
  FolderKanban,
  GitBranch,
  ListChecks,
} from "lucide-react";
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
  complete: "Complete",
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
          <span className="eyebrow">Local workspaces</span>
          <h1>Projects</h1>
          <p>
            A calm view of work Relay can connect through a repository and local
            Git evidence.
          </p>
        </div>
      </header>
      {projects.length ? (
        <div className="projects-list" aria-label="Projects with Git evidence">
          {projects.map((project) => (
            <Link
              key={project.key}
              className="project-card card"
              href={`/projects?project=${encodeURIComponent(project.key)}`}
            >
              <div>
                <div className="project-card-title">
                  <FolderKanban size={17} />
                  <h2>{project.repository}</h2>
                  {project.activeCount > 0 && <CircleDot size={13} />}
                </div>
                <p>
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
              <time title={absoluteTime(project.lastActivityAt)}>
                Updated {relativeTime(project.lastActivityAt)}
              </time>
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
          note={`of ${project.sessionCount} all time · ${windowLabel}`}
        />
        <Metric
          label="Elapsed time"
          value={runtime(detail.windowRuntimeMs)}
          note={`Recorded session time · ${windowLabel}`}
        />
        <Metric
          label="Cost"
          value={formatCostUsd(detail.totalCostUsd)}
          note={
            detail.unpricedSessionCount
              ? `${detail.unpricedSessionCount} unpriced sessions excluded`
              : `Complete local pricing · ${windowLabel}`
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

      <ProjectSpendCard detail={detail} windowLabel={windowLabel} />

      <div className="project-briefing-grid">
        <section
          className="card project-briefing-card"
          aria-labelledby="changes-title"
        >
          <span className="eyebrow">What changed recently</span>
          <h2 id="changes-title">Recent local activity</h2>
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
        <h2 id="context-title">Repository and worktrees</h2>
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
          <p className="project-muted">
            No local working directory recorded. Relay does not infer a project
            goal or save notes until you provide durable project context.
          </p>
        )}
      </section>

      <section
        className="card project-evidence"
        aria-labelledby="sessions-title"
      >
        <header className="projects-header">
          <div>
            <span className="eyebrow">Evidence</span>
            <h2 id="sessions-title">
              {detail.evidenceFilter === "attention"
                ? `${detail.attention.length} needing attention`
                : `${detail.sessions.length}${detail.sessionsTruncated ? "+" : ""} sessions · ${windowLabel}`}
            </h2>
          </div>
          <EvidenceFilter detail={detail} />
        </header>
        {detail.sessions.length ? (
          <div className="project-session-list">
            {detail.sessions.map((session) => (
              <Link key={session.id} href={`/sessions/${session.id}`}>
                <ListChecks size={15} />
                <div>
                  <strong>{session.title}</strong>
                  <p>
                    {providerLabels[session.provider]} · Updated{" "}
                    {relativeTime(session.updatedAt)}
                  </p>
                </div>
                <span className={`status-label status-${session.status}`}>
                  <i />
                  {statusDisplay(session.status, session.statusReason)}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="project-muted">
            {detail.evidenceFilter === "attention"
              ? "No sessions need attention in this range."
              : "No sessions in this range."}
          </p>
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
 * Links rather than buttons: the filter is a distinct server-rendered view, and
 * a link keeps it shareable and back-button friendly without a client bundle.
 */
function EvidenceFilter({ detail }: { detail: ProjectDetail }) {
  const base = `/projects?project=${encodeURIComponent(detail.project.key)}${
    detail.range === "7d" ? "" : `&range=${detail.range}`
  }`;
  const options = [
    { value: "all" as const, label: "All" },
    {
      value: "attention" as const,
      label: `Needs attention (${detail.attention.length})`,
    },
  ];
  return (
    <div className="overview-range" aria-label="Evidence filter">
      {options.map((option) => (
        <Link
          key={option.value}
          className={`btn ${
            detail.evidenceFilter === option.value
              ? "btn-accent"
              : "btn-outline"
          }`}
          href={option.value === "all" ? base : `${base}&evidence=attention`}
          aria-current={detail.evidenceFilter === option.value}
        >
          {option.label}
        </Link>
      ))}
    </div>
  );
}

/**
 * Daily spend across the selected range. The single total answers "how much",
 * the trend answers "is this getting more expensive" — which the total alone
 * cannot, and which is the question a project owner actually asks.
 */
function ProjectSpendCard({
  detail,
  windowLabel,
}: {
  detail: ProjectDetail;
  windowLabel: string;
}) {
  const peak = detail.costTrend.reduce(
    (max, day) => (day.costUsd > max ? day.costUsd : max),
    0,
  );
  return (
    <div className="project-briefing-grid">
      <section className="card project-briefing-card" aria-label="Spend trend">
        <span className="eyebrow">Spend over time</span>
        <h2>Daily cost · {windowLabel}</h2>
        {peak > 0 ? (
          <>
            <Sparkline
              className="project-spark"
              values={detail.costTrend.map((day) => day.costUsd)}
              label={`Daily cost for the ${windowLabel}`}
              slotTitle={(index) =>
                `${detail.costTrend[index].date} · ${formatCostUsd(
                  detail.costTrend[index].costUsd,
                )}`
              }
            />
            <p className="project-muted">
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
        <h2>Sessions by agent · {windowLabel}</h2>
        {detail.byProvider.length ? (
          <ul className="project-provider-split">
            {detail.byProvider.map((row) => (
              <li key={row.provider}>
                <span className={`badge ${providerBadges[row.provider]}`}>
                  {providerLabels[row.provider]}
                </span>
                <strong>{row.sessionCount} sessions</strong>
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
