import { ProjectsView } from "@/components/projects-view";
import { Sidebar } from "@/components/sidebar";
import { refreshIngestedData } from "@/lib/auto-sync";
import {
  getCollectorHealth,
  getProjectDetail,
  getProjects,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

interface ProjectsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ProjectsPage({
  searchParams,
}: ProjectsPageProps) {
  await refreshIngestedData();
  const params = await searchParams;
  const key = Array.isArray(params.project)
    ? params.project[0]
    : params.project;
  const health = getCollectorHealth();
  const projects = getProjects().filter(
    (project) => project.category === "project",
  );
  return (
    <main className="relay-shell">
      <Sidebar
        connectedAgents={health.connectedAgents}
        sourceErrors={health.parseErrors}
      />
      <ProjectsView
        projects={projects}
        selected={key ? getProjectDetail(key) : null}
      />
    </main>
  );
}
