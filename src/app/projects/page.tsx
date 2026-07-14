import { ProjectsView } from "@/components/projects-view";
import { Sidebar } from "@/components/sidebar";
import {
  getCollectorHealth,
  getProjects,
  getProjectSessions,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

interface ProjectsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ProjectsPage({
  searchParams,
}: ProjectsPageProps) {
  const params = await searchParams;
  const projects = getProjects();
  const selectedKey = first(params.selected);
  const selected =
    projects.find((project) => project.key === selectedKey) ??
    projects[0] ??
    null;
  const sessions = selected ? getProjectSessions(selected.key) : [];
  const health = getCollectorHealth();
  return (
    <main className="relay-shell">
      <Sidebar
        connectedAgents={health.connectedAgents}
        sourceErrors={health.parseErrors}
      />
      <ProjectsView
        projects={projects}
        selected={selected}
        sessions={sessions}
      />
    </main>
  );
}
