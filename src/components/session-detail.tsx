import { ArrowLeft, Command, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import {
  absoluteTime,
  elapsed,
  formatCostUsd,
  formatTokens,
  relativeTime,
} from "@/lib/format";
import {
  costSourceLabels,
  providerBadges,
  providerLabels,
  statusLabels,
} from "@/lib/labels";
import type {
  SessionDetail,
  SessionListItem,
  SessionUsageDetail,
} from "@/lib/queries";
import type { SessionTranscript } from "@/lib/transcript";
import { TranscriptView } from "./transcript-view";

interface SessionDetailViewProps {
  session: SessionDetail;
  parent: SessionListItem | null;
  subagents: SessionListItem[];
  usage: SessionUsageDetail;
  transcript: SessionTranscript;
}

function totalTokens(session: SessionDetail): string {
  const total = (session.inputTokens ?? 0) + (session.outputTokens ?? 0);
  return total ? formatTokens(total) : "Unavailable";
}

export function SessionDetailView({
  session,
  parent,
  subagents,
  usage,
  transcript,
}: SessionDetailViewProps) {
  return (
    <section className="relay-content session-detail-page">
      <Link className="back-link" href="/sessions">
        <ArrowLeft size={14} />
        Back to sessions
      </Link>

      <header className="detail-page-header">
        <div>
          <span className="mono detail-session-id">
            {session.provider.toUpperCase()} · {session.externalId.slice(0, 12)}
          </span>
          <h1>{session.title}</h1>
          <div className="inspector-badges">
            <span className={`badge ${providerBadges[session.provider]}`}>
              {providerLabels[session.provider]}
            </span>
            <span className={`status-label status-${session.status}`}>
              <i />
              {statusLabels[session.status]}
            </span>
          </div>
        </div>
        <div className="detail-time">
          <span title={relativeTime(session.startedAt)}>
            Started {absoluteTime(session.startedAt)}
          </span>
          <strong>
            {elapsed(session.startedAt, session.endedAt ?? session.updatedAt)}
          </strong>
        </div>
      </header>

      {parent && (
        <div className="session-parent-link card">
          <Users size={16} />
          <div>
            <span className="eyebrow">Main session</span>
            <Link href={`/sessions/${parent.id}`}>{parent.title}</Link>
          </div>
        </div>
      )}

      <div className="session-detail-grid card" aria-label="Session details">
        <Detail
          label="Repository"
          value={session.repository ?? "Unavailable"}
        />
        <Detail label="Branch" value={session.branch ?? "Unavailable"} mono />
        <Detail label="Model" value={session.model ?? "Unavailable"} mono />
        <Detail label="Tokens" value={totalTokens(session)} />
        <Detail
          label="Cache"
          value={
            session.cachedTokens ? formatTokens(session.cachedTokens) : "None"
          }
        />
        <Detail
          label="Cost"
          value={
            usage.costUsd !== null
              ? `${formatCostUsd(usage.costUsd)} · ${costSourceLabels[usage.costSource]}`
              : "Unavailable"
          }
        />
      </div>

      {subagents.length > 0 && (
        <section
          className="session-children card"
          aria-labelledby="subagents-title"
        >
          <header>
            <div>
              <span className="eyebrow">Delegated work</span>
              <h2 id="subagents-title">Subagents</h2>
            </div>
            <span>{subagents.length} sessions</span>
          </header>
          <div className="session-children-list">
            {subagents.map((child) => (
              <Link key={child.id} href={`/sessions/${child.id}`}>
                <div>
                  <strong>{child.title}</strong>
                  <span className="mono">
                    {child.agentLabel ?? "Subagent"} ·{" "}
                    {elapsed(child.startedAt, child.endedAt ?? child.updatedAt)}
                    {child.costUsd != null
                      ? ` · ${formatCostUsd(child.costUsd)}`
                      : ""}
                  </span>
                </div>
                <span className={`status-label status-${child.status}`}>
                  <i />
                  {statusLabels[child.status]}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="payload-notice">
        <ShieldCheck size={16} />
        <p>
          This transcript is read from local provider storage on demand. Common
          credentials are redacted, raw reasoning records are excluded, and
          payloads are not copied into Relay’s database. Provider-injected
          context may still appear inside user or assistant messages.
        </p>
      </div>

      <section
        className="transcript-section"
        aria-labelledby="transcript-title"
      >
        <header className="transcript-heading">
          <div>
            <span className="eyebrow">Session log</span>
            <h2 id="transcript-title">Conversation and tool payloads</h2>
          </div>
          <span>
            {transcript.entries.length} entries
            {transcript.truncated
              ? " · newest 500 shown; older entries remain in the source file"
              : ""}
          </span>
        </header>

        {transcript.entries.length ? (
          <TranscriptView transcript={transcript} />
        ) : (
          <div className="empty-state card">
            <Command size={24} />
            <h3>No detailed transcript available</h3>
            <p>
              {transcript.sourceAvailable
                ? "This provider did not expose supported message or tool payload records."
                : "No readable local transcript source was found for this session."}
            </p>
          </div>
        )}
      </section>
    </section>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <span className="eyebrow">{label}</span>
      <strong className={mono ? "mono" : ""}>{value}</strong>
    </div>
  );
}
