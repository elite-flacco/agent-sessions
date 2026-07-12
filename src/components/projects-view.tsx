"use client";

import {
  CircleDot,
  FolderKanban,
  GitBranch,
  HelpCircle,
  MoreHorizontal,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { elapsed, relativeTime, runtime } from "@/lib/format";
import { providerBadges, providerLabels, statusLabels } from "@/lib/labels";
import type { ProjectSummary, SessionListItem } from "@/lib/queries";
import { UNKNOWN_PROJECT_KEY } from "@/lib/types";

interface ProjectsViewProps {
  projects: ProjectSummary[];
  selected: ProjectSummary | null;
  sessions: SessionListItem[];
}

export function ProjectsView({
  projects,
  selected,
  sessions,
}: ProjectsViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [router]);

  function select(key: string): void {
    const params = new URLSearchParams(window.location.search);
    params.set("selected", key);
    startTransition(() => router.replace(`${pathname}?${params.toString()}`));
  }

  return (
    <section className="relay-content">
      <header className="page-header">
        <div>
          <h1>Projects</h1>
          <p>Sessions grouped by repository and working directory.</p>
        </div>
      </header>

      <div className={`workspace-grid ${isPending ? "workspace-loading" : ""}`}>
        <section className="session-panel" aria-label="Projects">
          <div className="project-table-head session-table-head">
            <span>Project</span>
            <span>Agents</span>
            <span>Sessions</span>
            <span>Runtime</span>
            <span>Last activity</span>
          </div>
          {projects.length ? (
            projects.map((project) => (
              <button
                key={project.key}
                className={`project-row session-row ${selected?.key === project.key ? "session-selected" : ""}`}
                onClick={() => select(project.key)}
              >
                <div className="session-primary">
                  <strong>
                    {project.repository ?? "Unknown workspace"}
                    {project.activeCount > 0 && (
                      <span className="project-active-dot" aria-hidden />
                    )}
                  </strong>
                  <span className="mono">
                    {project.workdirs.length
                      ? project.workdirs.join(" · ")
                      : "No working directory recorded"}
                  </span>
                </div>
                <div className="project-badges">
                  {project.providers.map((provider) => (
                    <span
                      key={provider}
                      className={`badge ${providerBadges[provider]}`}
                    >
                      {providerLabels[provider]}
                    </span>
                  ))}
                </div>
                <span className="mono session-secondary">
                  {project.sessionCount}
                  {project.activeCount > 0
                    ? ` (${project.activeCount} active)`
                    : ""}
                </span>
                <span className="mono session-secondary">
                  {runtime(project.totalRuntimeMs)}
                </span>
                <span className="mono session-secondary">
                  {relativeTime(project.lastActivityAt)}
                </span>
              </button>
            ))
          ) : (
            <div className="empty-state">
              <FolderKanban size={24} />
              <h3>No projects yet</h3>
              <p>Projects appear once sessions are imported.</p>
            </div>
          )}
          <footer className="session-footer">
            <span>Showing {projects.length} projects</span>
            <span>{isPending ? "Updating…" : "Updated from local files"}</span>
          </footer>
        </section>
        <ProjectInspector project={selected} sessions={sessions} />
      </div>
    </section>
  );
}

function ProjectInspector({
  project,
  sessions,
}: {
  project: ProjectSummary | null;
  sessions: SessionListItem[];
}) {
  if (!project)
    return (
      <aside className="inspector inspector-empty">
        <FolderKanban size={24} />
        <p>Select a project to inspect its sessions.</p>
      </aside>
    );
  const isUnknown = project.key === UNKNOWN_PROJECT_KEY;
  return (
    <aside className="inspector">
      <div className="inspector-heading">
        <span className="mono">
          {isUnknown ? "NEEDS REVIEW" : "PROJECT"} · {project.sessionCount}{" "}
          sessions
        </span>
        <MoreHorizontal size={16} />
      </div>
      <h2>{project.repository ?? "Unknown workspace"}</h2>
      <div className="inspector-badges">
        {project.providers.map((provider) => (
          <span key={provider} className={`badge ${providerBadges[provider]}`}>
            {providerLabels[provider]}
          </span>
        ))}
      </div>
      {isUnknown ? (
        <p>
          <HelpCircle size={13} className="inline-icon" /> These sessions have
          no repository context in their source files (typical for Zcode
          model-I/O histories). They stay grouped here for review until their
          provider exposes a working directory.
        </p>
      ) : (
        <p>
          {project.workdirs.length
            ? `Local paths: ${project.workdirs.join(", ")}`
            : "No working directory recorded for this project."}
        </p>
      )}
      <div className="detail-grid">
        <Detail label="Sessions" value={String(project.sessionCount)} />
        <Detail
          label="Active now"
          value={String(project.activeCount)}
          accent={project.activeCount > 0}
        />
        <Detail label="Total runtime" value={runtime(project.totalRuntimeMs)} />
        <Detail
          label="Last activity"
          value={relativeTime(project.lastActivityAt)}
        />
      </div>
      {project.branches.length > 0 && (
        <div className="branch-list">
          <span className="eyebrow">Recent branches</span>
          <div>
            {project.branches.slice(0, 6).map((branch) => (
              <span key={branch} className="branch-chip mono">
                <GitBranch size={11} />
                {branch}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="activity-heading">
        <span className="eyebrow">Session history</span>
        <span>{sessions.length} shown</span>
      </div>
      <div className="activity-list">
        {sessions.map((session) => (
          <Link
            key={session.id}
            className="project-session-row"
            href={`/?range=all&selected=${session.id}`}
          >
            <span className={`status-label status-${session.status}`}>
              <i />
            </span>
            <div>
              <strong>{session.title}</strong>
              <p>
                {providerLabels[session.provider]} ·{" "}
                {statusLabels[session.status]} ·{" "}
                {elapsed(
                  session.startedAt,
                  session.endedAt ?? session.updatedAt,
                )}
              </p>
            </div>
            <time>{relativeTime(session.startedAt)}</time>
          </Link>
        ))}
      </div>
    </aside>
  );
}

function Detail({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <span className="eyebrow">{label}</span>
      <strong className={accent ? "detail-accent" : ""}>
        {accent && <CircleDot size={10} />}
        {value}
      </strong>
    </div>
  );
}
