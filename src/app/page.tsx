import { OverviewView } from "@/components/overview-view";
import { Sidebar } from "@/components/sidebar";
import { refreshIngestedData } from "@/lib/auto-sync";
import { DASHBOARD_REFRESH_INTERVAL_MS } from "@/lib/polling";
import {
  getAttentionSessions,
  getCollectorHealth,
  getOverview,
  getOverviewPatterns,
  getProjects,
  getRunningSessions,
  parseOverviewRange,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

interface OverviewPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OverviewPage({
  searchParams,
}: OverviewPageProps) {
  await refreshIngestedData(DASHBOARD_REFRESH_INTERVAL_MS);
  const health = getCollectorHealth();
  const range = parseOverviewRange(first((await searchParams).range));
  return (
    <main className="relay-shell">
      <Sidebar
        connectedAgents={health.connectedAgents}
        sourceErrors={health.parseErrors}
      />
      <OverviewView
        range={range}
        overview={getOverview(range)}
        patterns={getOverviewPatterns(range)}
        running={getRunningSessions()}
        attention={getAttentionSessions()}
        recentProjects={getProjects()
          .filter((project) => project.category === "project")
          .slice(0, 5)}
      />
    </main>
  );
}
