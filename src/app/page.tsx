import { OverviewView } from "@/components/overview-view";
import { Sidebar } from "@/components/sidebar";
import {
  getAttentionSessions,
  getCollectorHealth,
  getOverview,
  getOverviewPatterns,
  getProjects,
  getRunningSessions,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const health = getCollectorHealth();
  return (
    <main className="relay-shell">
      <Sidebar
        connectedAgents={health.connectedAgents}
        sourceErrors={health.parseErrors}
      />
      <OverviewView
        overview={getOverview()}
        patterns={getOverviewPatterns()}
        running={getRunningSessions()}
        attention={getAttentionSessions()}
        recentProjects={getProjects()
          .filter((project) => project.category === "project")
          .slice(0, 5)}
      />
    </main>
  );
}
