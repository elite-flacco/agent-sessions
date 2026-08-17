import { Dashboard, type WorkspaceView } from "@/components/dashboard";
import { Sidebar } from "@/components/sidebar";
import { refreshIngestedData } from "@/lib/auto-sync";
import {
  firstParam,
  getModelOptions,
  getProjectOptions,
  getProjectsWithCosts,
  getSessions,
  getSummary,
  getSyncState,
  getUsageSummary,
  parseOverviewRange,
  type SessionFilters,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

interface HomeProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Home({ searchParams }: HomeProps) {
  await refreshIngestedData();
  const params = await searchParams;
  const filters: SessionFilters = {
    q: firstParam(params.q),
    provider: firstParam(params.provider),
    status: firstParam(params.status),
    range: firstParam(params.range),
    sort: firstParam(params.sort),
    project: firstParam(params.project),
    model: firstParam(params.model),
  };
  const sessions = getSessions(filters);
  const view: WorkspaceView =
    firstParam(params.view) === "projects" ? "projects" : "sessions";
  const summary = getSummary();
  const syncState = getSyncState();
  return (
    <main className="agentarium-shell">
      <Sidebar
        connectedAgents={summary.connectedAgents}
        sourceErrors={syncState.errors}
      />
      <Dashboard
        sessions={sessions}
        projects={getProjectsWithCosts(filters)}
        projectOptions={getProjectOptions()}
        modelOptions={getModelOptions()}
        summary={summary}
        syncState={syncState}
        costToday={getUsageSummary().today}
        filters={filters}
        range={parseOverviewRange(filters.range)}
        isTodayRange={filters.range === "today"}
        view={view}
      />
    </main>
  );
}
