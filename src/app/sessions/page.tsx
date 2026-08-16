import { Dashboard, type WorkspaceView } from "@/components/dashboard";
import { Sidebar } from "@/components/sidebar";
import { refreshIngestedData } from "@/lib/auto-sync";
import {
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

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Home({ searchParams }: HomeProps) {
  await refreshIngestedData();
  const params = await searchParams;
  const filters: SessionFilters = {
    q: first(params.q),
    provider: first(params.provider),
    status: first(params.status),
    range: first(params.range),
    sort: first(params.sort),
    project: first(params.project),
    model: first(params.model),
  };
  const sessions = getSessions(filters);
  const view: WorkspaceView =
    first(params.view) === "projects" ? "projects" : "sessions";
  const summary = getSummary();
  const syncState = getSyncState();
  return (
    <main className="relay-shell">
      <Sidebar
        connectedAgents={summary.connectedAgents}
        sourceErrors={syncState.errors}
      />
      <Dashboard
        sessions={sessions}
        projects={getProjectsWithCosts(filters, sessions)}
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
