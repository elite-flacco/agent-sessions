import { ArrowLeft, CircleDot, FolderKanban, GitBranch } from "lucide-react";
import Link from "next/link";
import {
  absoluteTime,
  formatCostUsd,
  relativeTime,
  runtime,
  shortenHomePath,
} from "@/lib/format";
import { providerBadges, providerLabels, rangeDaysLabel } from "@/lib/labels";
import type { ProjectDetail, ProjectSummary } from "@/lib/queries";
import { Sparkline } from "./charts";
import { RangeSwitcher } from "./range-switcher";

interface ProjectsViewProps {
  projects: ProjectSummary[];
  selected: ProjectDetail | null;
}

function GitHubMark() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none"
      data-icon="github"
      fill="currentColor"
      focusable="false"
      height="16"
      viewBox="0 0 16 16"
      width="16"
    >
      {/* GitHub Mark from Primer Octicons, MIT licensed. */}
      <path d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656" />
    </svg>
  );
}

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
          <p>All your projects at a glance</p>
        </div>
      </header>
      {projects.length ? (
        <div className="projects-grid" aria-label="Projects with Git evidence">
          {projects.map((project) => (
            <article key={project.key} className="project-card card">
              <Link
                aria-label={`Open ${project.repository} project briefing`}
                className="project-card-link"
                href={`/projects?project=${encodeURIComponent(project.key)}`}
              >
                <div>
                  <div className="project-card-title pr-8">
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
              {project.githubUrl && (
                <a
                  aria-label={`Open ${project.repository} on GitHub`}
                  className="absolute top-4 right-4 z-10 inline-flex rounded-md p-1 text-muted-foreground hover:text-foreground"
                  href={project.githubUrl}
                  rel="noreferrer"
                  target="_blank"
                  title={`Open ${project.repository} on GitHub`}
                >
                  <GitHubMark />
                </a>
              )}
            </article>
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
  const windowLabel =
    detail.range === "all"
      ? "across all time"
      : `in the last ${rangeDaysLabel(detail.range)}`;
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
                    <p>{providerLabels[event.provider]} · </p>
                  </div>
                  <time title={absoluteTime(event.occurredAt)}>
                    {relativeTime(event.occurredAt)}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <p className="project-muted">
              No retained start, file, check, or completion events {windowLabel}
              .
            </p>
          )}
        </section>

        <section
          className="card project-briefing-card"
          aria-labelledby="expensive-sessions-title"
        >
          <span className="eyebrow">What cost the most</span>
          <h2 id="expensive-sessions-title">Most expensive sessions</h2>
          {detail.largestCostSessions.length ? (
            <ol className="mt-4 grid list-none gap-2 p-0">
              {detail.largestCostSessions.slice(0, 5).map((session) => (
                <li
                  className="flex min-w-0 items-start justify-between gap-2 border-t border-border pt-2"
                  key={session.id}
                >
                  <div className="min-w-0">
                    <Link
                      className="text-foreground hover:text-accent"
                      href={`/sessions/${session.id}`}
                    >
                      <strong className="block truncate text-xs leading-normal font-semibold">
                        {session.title}
                      </strong>
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {providerLabels[session.provider]}
                    </p>
                  </div>
                  <span className="shrink-0 text-muted-foreground">
                    {formatCostUsd(session.costUsd ?? 0)}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="project-muted">
              No fully priced sessions in this range.
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
