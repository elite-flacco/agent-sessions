import { notFound } from "next/navigation";
import { SessionDetailView } from "@/components/session-detail";
import { Sidebar } from "@/components/sidebar";
import {
  getCollectorHealth,
  getSession,
  getSessionChildren,
  getSessionParent,
  getSessionsCostUsd,
  getSessionUsage,
} from "@/lib/queries";
import { readSessionTranscript } from "@/lib/transcript";

export const dynamic = "force-dynamic";

interface SessionPageProps {
  params: Promise<{ id: string }>;
}

export default async function SessionPage({ params }: SessionPageProps) {
  const { id } = await params;
  const sessionId = Number(id);
  if (!Number.isInteger(sessionId) || sessionId < 1) notFound();
  const session = getSession(sessionId);
  if (!session) notFound();
  const health = getCollectorHealth();
  const transcript = await readSessionTranscript(session);
  const subagents = getSessionChildren(session);
  const subagentCosts = getSessionsCostUsd(subagents.map((child) => child.id));
  for (const child of subagents)
    child.costUsd = subagentCosts.get(child.id) ?? null;
  return (
    <main className="relay-shell">
      <Sidebar
        connectedAgents={health.connectedAgents}
        sourceErrors={health.parseErrors}
      />
      <SessionDetailView
        session={session}
        parent={getSessionParent(session)}
        subagents={subagents}
        usage={getSessionUsage(session.id)}
        transcript={transcript}
      />
    </main>
  );
}
