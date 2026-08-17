import {
  AgentSetupView,
  parseAgentSetupFilters,
} from "@/components/agent-setup-view";
import { Sidebar } from "@/components/sidebar";
import { getAgentInventories } from "@/lib/agent-inventory";
import { getCollectorHealth } from "@/lib/queries";

export const dynamic = "force-dynamic";

interface AgentsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AgentsPage({ searchParams }: AgentsPageProps) {
  const health = getCollectorHealth();
  const inventories = await getAgentInventories({ kind: "global" });
  const filters = parseAgentSetupFilters(await searchParams);
  return (
    <main className="agentarium-shell">
      <Sidebar
        connectedAgents={health.connectedAgents}
        sourceErrors={health.parseErrors}
      />
      <AgentSetupView inventories={inventories} filters={filters} />
    </main>
  );
}
