import { Sidebar } from "@/components/sidebar";
import { UsageView } from "@/components/usage-view";
import {
  countSessions,
  getCollectorHealth,
  getUsageSummary,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function UsagePage() {
  const health = getCollectorHealth();
  return (
    <main className="relay-shell">
      <Sidebar
        sessionCount={countSessions()}
        connectedAgents={health.connectedAgents}
        sourceErrors={health.parseErrors}
      />
      <UsageView usage={getUsageSummary()} />
    </main>
  );
}
