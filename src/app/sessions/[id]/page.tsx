import type { Metadata } from "next";
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

export async function generateMetadata({
  params,
}: SessionPageProps): Promise<Metadata> {
  const { id } = await params;
  const sessionId = Number(id);
  if (!Number.isInteger(sessionId) || sessionId < 1) return {};
  const session = getSession(sessionId);
  if (!session) return {};
  return {
    title: `${session.title} — Agentarium`,
    description: `${session.provider} session${session.repository ? ` in ${session.repository}` : ""}.`,
  };
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
    <main className="agentarium-shell">
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
