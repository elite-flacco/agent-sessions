import { ProjectsView } from "@/components/projects-view";
import { Sidebar } from "@/components/sidebar";
import { refreshIngestedData } from "@/lib/auto-sync";
import {
  firstParam,
  getCollectorHealth,
  getProjectDetail,
  getProjectsWithCosts,
  parseOverviewRange,
  parseProjectEvidenceFilter,
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
  const key = firstParam(params.project);
  const range = parseOverviewRange(firstParam(params.range));
  const evidence = parseProjectEvidenceFilter(firstParam(params.evidence));
  const health = getCollectorHealth();
  const projects = getProjectsWithCosts({ range: "all" }).filter(
    (project) => project.category === "project",
  );
  return (
    <main className="agentarium-shell">
      <Sidebar
        connectedAgents={health.connectedAgents}
        sourceErrors={health.parseErrors}
      />
      <ProjectsView
        projects={projects}
        selected={key ? getProjectDetail(key, range, evidence) : null}
      />
    </main>
  );
}
