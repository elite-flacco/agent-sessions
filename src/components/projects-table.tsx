import { FolderKanban } from "lucide-react";
import {
  absoluteTime,
  formatCostUsd,
  pluralize,
  relativeTime,
  runtime,
} from "@/lib/format";
import type { ProjectCostSummary } from "@/lib/queries";
import { ProviderBadge } from "./provider-badge";

export function ProjectsTable({
  projects,
}: {
  projects: ProjectCostSummary[];
}) {
  const projectCount = projects.filter(
    (project) => project.category === "project",
  ).length;
  const taskGroup = projects.find((project) => project.category === "task");
  return (
    <section className="session-panel workspace-table" aria-label="Projects">
      <div className="project-table-head session-table-head">
        <span>Project</span>
        <span>Agents</span>
        <span>Sessions</span>
        <span>Total cost</span>
        <span>Runtime</span>
        <span>Last activity</span>
      </div>
      {projects.length ? (
        projects.map((project) => (
          <div key={project.key} className="project-row session-row">
            <div className="session-primary">
              <strong>
                {project.category === "task" ? "Tasks" : project.repository}
                {project.activeCount > 0 && (
                  <span className="project-active-dot" aria-hidden />
                )}
              </strong>
              <span className="mono">
                {project.category === "task"
                  ? `${project.workdirs.length} one-off workspaces without Git context`
                  : project.workdirs.length
                    ? project.workdirs.join(" · ")
                    : "No working directory recorded"}
              </span>
            </div>
            <div className="project-badges">
              {project.providers.map((provider) => (
                <ProviderBadge key={provider} provider={provider} />
              ))}
            </div>
            <span className="mono session-secondary">
              {project.sessionCount}
              {project.activeCount > 0
                ? ` (${project.activeCount} active)`
                : ""}
            </span>
            <span
              className="mono session-secondary"
              title={
                project.unpricedSessionCount
                  ? `Excludes ${project.unpricedSessionCount} ${pluralize(project.unpricedSessionCount, "session")} without complete pricing`
                  : undefined
              }
            >
              {project.totalCostUsd != null
                ? formatCostUsd(project.totalCostUsd)
                : "—"}
            </span>
            <span className="mono session-secondary">
              {runtime(project.totalRuntimeMs)}
            </span>
            <span
              className="mono session-secondary"
              title={absoluteTime(project.lastActivityAt)}
            >
              {relativeTime(project.lastActivityAt)}
            </span>
          </div>
        ))
      ) : (
        <div className="empty-state">
          <FolderKanban size={24} />
          <h3>No matching projects</h3>
          <p>Adjust the shared filters to widen the project rollup.</p>
        </div>
      )}
      <footer className="session-footer">
        <span>
          Showing {projectCount} projects
          {taskGroup ? ` · ${taskGroup.sessionCount} tasks` : ""}
        </span>
      </footer>
    </section>
  );
}
