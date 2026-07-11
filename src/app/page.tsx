import { Dashboard } from "@/components/dashboard";
import {
  getSessionEvents,
  getSessions,
  getSummary,
  getSyncState,
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
  const params = await searchParams;
  const filters: SessionFilters = {
    q: first(params.q),
    provider: first(params.provider),
    status: first(params.status),
    range: first(params.range),
    selected: first(params.selected),
  };
  const sessions = getSessions(filters);
  const selected =
    sessions.find((session) => String(session.id) === filters.selected) ??
    sessions[0];
  const events = selected ? getSessionEvents(selected.id) : [];
  return (
    <Dashboard
      sessions={sessions}
      selected={selected ?? null}
      events={events}
      summary={getSummary()}
      syncState={getSyncState()}
      filters={filters}
    />
  );
}
