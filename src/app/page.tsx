import { OverviewView } from "@/components/overview-view";
import { Sidebar } from "@/components/sidebar";
import {
  countSessions,
  getAttentionSessions,
  getCollectorHealth,
  getOverview,
  getProjects,
  getRunningSessions,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const health = getCollectorHealth();
  return (
    <main className="relay-shell">
      <Sidebar
        sessionCount={countSessions()}
        connectedAgents={health.connectedAgents}
        sourceErrors={health.parseErrors}
      />
      <OverviewView
        overview={getOverview()}
        running={getRunningSessions()}
        attention={getAttentionSessions()}
        recentProjects={getProjects().slice(0, 5)}
      />
    </main>
  );
}
