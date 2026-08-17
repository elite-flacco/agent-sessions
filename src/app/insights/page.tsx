import { Sidebar } from "@/components/sidebar";
import { InsightsView } from "@/components/insights-view";
import { getAgentInventories } from "@/lib/agent-inventory";
import {
  firstParam,
  getCollectorHealth,
  getInsights,
  parseOverviewRange,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

interface InsightsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function InsightsPage({
  searchParams,
}: InsightsPageProps) {
  const params = await searchParams;
  const range = parseOverviewRange(firstParam(params.range));
  const inventories = await getAgentInventories({ kind: "global" });
  const health = getCollectorHealth();
  return (
    <main className="agentarium-shell">
      <Sidebar
        connectedAgents={health.connectedAgents}
        sourceErrors={health.parseErrors}
      />
      <InsightsView range={range} insights={getInsights(range, inventories)} />
    </main>
  );
}
