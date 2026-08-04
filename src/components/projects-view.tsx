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
} from "@/lib/format";
import { providerBadges, providerLabels, statusDisplay } from "@/lib/labels";
import type {
  ProjectDetail,
  ProjectState,
  ProjectSummary,
} from "@/lib/queries";

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
        <span className={`project-state project-state-${detail.state}`}>
          <CircleDot size={13} />
          {stateLabels[detail.state]}
        </span>
      </header>

      <div className="summary-grid project-metrics" aria-label="Project rollup">
        <Metric
          label="Sessions"
          value={String(project.sessionCount)}
          note="Grouped from local Git evidence"
        />
        <Metric
          label="Elapsed time"
          value={runtime(project.totalRuntimeMs)}
          note="Recorded session time"
        />
        <Metric
          label="Cost"
          value={
            detail.totalCostUsd === null
              ? "Unavailable"
              : formatCostUsd(detail.totalCostUsd)
          }
          note={
            detail.totalCostUsd === null
              ? "At least one session lacks complete pricing."
              : "Complete local pricing"
          }
        />
        <Metric
          label="Largest contributor"
          value={
            detail.largestCostSession?.costUsd != null
              ? formatCostUsd(detail.largestCostSession.costUsd)
              : "Unavailable"
          }
          note={detail.largestCostSession?.title ?? "No priced session"}
        />
      </div>

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
                <li
                  key={`${event.sessionId}-${event.occurredAt}-${event.title}`}
                >
                  <span className="project-list-marker" aria-hidden />
                  <div>
                    <strong>{event.title}</strong>
                    {event.detail && <p>{event.detail}</p>}
                  </div>
                  <time title={absoluteTime(event.occurredAt)}>
                    {relativeTime(event.occurredAt)}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <p className="project-muted">
              No retained start, file, check, or completion events yet.
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
        <div className="project-context-list">
          <div>
            <GitBranch size={15} />
            <strong>
              {project.branches.join(", ") || "No branch recorded"}
            </strong>
          </div>
          {project.workdirs.map((workdir) => (
            <code key={workdir}>{workdir}</code>
          ))}
        </div>
        <p className="project-muted">
          Relay does not infer a project goal or save notes until you provide
          durable project context.
        </p>
      </section>

      <section
        className="card project-evidence"
        aria-labelledby="sessions-title"
      >
        <span className="eyebrow">Evidence</span>
        <h2 id="sessions-title">Newest 50 sessions</h2>
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
      </section>
    </section>
  );
}

function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="metric">
      <span className="eyebrow">{label}</span>
      <strong>{value}</strong>
      {note && <span>{note}</span>}
    </div>
  );
}
