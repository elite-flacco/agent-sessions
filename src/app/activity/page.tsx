import { ActivityStream } from "@/components/activity-stream";
import { Sidebar } from "@/components/sidebar";
import { groupStream } from "@/lib/activity";
import { refreshIngestedData } from "@/lib/live-sync";
import {
  getActivityStream,
  getCollectorHealth,
  getRepositories,
  type ActivityStreamFilters,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

interface ActivityPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ActivityPage({
  searchParams,
}: ActivityPageProps) {
  await refreshIngestedData();
  const params = await searchParams;
  const filters: ActivityStreamFilters = {
    provider: first(params.provider),
    repo: first(params.repo),
  };
  const rows = getActivityStream(filters);
  const health = getCollectorHealth();
  return (
    <main className="relay-shell">
      <Sidebar
        connectedAgents={health.connectedAgents}
        sourceErrors={health.parseErrors}
      />
      <ActivityStream
        blocks={groupStream(rows)}
        totalEvents={rows.length}
        repositories={getRepositories()}
        filters={filters}
        health={health}
      />
    </main>
  );
}
