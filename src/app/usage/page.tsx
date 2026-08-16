import { Sidebar } from "@/components/sidebar";
import { UsageView } from "@/components/usage-view";
import {
  getCollectorHealth,
  getUsageSummary,
  parseOverviewRange,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

interface UsagePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function UsagePage({ searchParams }: UsagePageProps) {
  const value = (await searchParams).range;
  const range = parseOverviewRange(Array.isArray(value) ? value[0] : value);
  const health = getCollectorHealth();
  return (
    <main className="relay-shell">
      <Sidebar
        connectedAgents={health.connectedAgents}
        sourceErrors={health.parseErrors}
      />
      <UsageView usage={getUsageSummary(range)} range={range} />
    </main>
  );
}
