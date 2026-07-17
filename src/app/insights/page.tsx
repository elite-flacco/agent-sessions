import { Sidebar } from "@/components/sidebar";
import { InsightsView } from "@/components/insights-view";
import { getCollectorHealth, getInsights } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const health = getCollectorHealth();
  return (
    <main className="relay-shell">
      <Sidebar
        connectedAgents={health.connectedAgents}
        sourceErrors={health.parseErrors}
      />
      <InsightsView insights={getInsights()} />
    </main>
  );
}
