import { ArrowLeft, Command, Users } from "lucide-react";
import Link from "next/link";
import {
  absoluteTime,
  elapsed,
  formatCostUsd,
  formatTokens,
  relativeTime,
} from "@/lib/format";
import { childSessionsNoun, costSourceLabels } from "@/lib/labels";
import type {
  SessionDetail,
  SessionListItem,
  SessionUsageDetail,
} from "@/lib/queries";
import type { SessionTranscript } from "@/lib/transcript";
import { ProviderBadge } from "./provider-badge";
import { StatusLabel } from "./status-label";
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
    <section className="agentarium-content session-detail-page">
      <Link className="back-link" href="/sessions">
        <ArrowLeft size={14} />
        Back to sessions
      </Link>

      <header className="detail-page-header">
        <div>
          <span className="mono text-muted-foreground">
            {session.provider.toUpperCase()} · {session.externalId.slice(0, 12)}
          </span>
          <h2>{session.title}</h2>
          <div className="inspector-badges">
            <ProviderBadge provider={session.provider} />
            <StatusLabel
              status={session.status}
              reason={session.statusReason}
            />
          </div>
        </div>
        <div className="detail-time">
          <span
            className="text-muted-foreground"
            title={relativeTime(session.startedAt)}
          >
            Started {absoluteTime(session.startedAt)}
          </span>
          <strong className="text-lg">
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
          label={subagents.length ? "Cost (incl. subagents)" : "Cost"}
          value={
            usage.totalCostUsd !== null
              ? `${formatCostUsd(usage.totalCostUsd)} · ${costSourceLabels[usage.totalCostSource]}`
              : "Unavailable"
          }
        />
        {subagents.length > 0 && (
          <>
            <Detail
              label="Main agent cost"
              value={
                usage.costUsd !== null
                  ? formatCostUsd(usage.costUsd)
                  : "Unavailable"
              }
            />
            <Detail
              label="Subagent cost"
              value={
                usage.subagentCostUsd !== null
                  ? formatCostUsd(usage.subagentCostUsd)
                  : "Unavailable"
              }
            />
          </>
        )}
      </div>

      {subagents.length > 0 && (
        <section
          className="session-children card"
          aria-labelledby="subagents-title"
        >
          <header>
            <div>
              <span className="eyebrow">Delegated work</span>
              <h3 id="subagents-title">
                {childSessionsNoun(
                  subagents.map((child) => child.sessionKind),
                ) === "thread"
                  ? "Threads"
                  : "Subagents"}
              </h3>
            </div>
            <span className="text-muted-foreground">
              {subagents.length} sessions
            </span>
          </header>
          <div className="session-children-list">
            {subagents.map((child) => (
              <Link key={child.id} href={`/sessions/${child.id}`}>
                <div>
                  <strong className="truncate text-sm">{child.title}</strong>
                  <span className="mono text-muted-foreground">
                    {child.sessionKind === "thread"
                      ? "Thread"
                      : (child.agentLabel ?? "Subagent")}{" "}
                    ·{" "}
                    {elapsed(child.startedAt, child.endedAt ?? child.updatedAt)}
                    {child.costUsd != null
                      ? ` · ${formatCostUsd(child.costUsd)}`
                      : ""}
                  </span>
                </div>
                <StatusLabel
                  status={child.status}
                  reason={child.statusReason}
                />
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-6" aria-labelledby="transcript-title">
        <header className="transcript-heading">
          <div>
            <h3>Session log</h3>
          </div>
          <span className="text-muted-foreground">
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
      <strong className={mono ? "mono truncate text-xs" : "truncate text-xs"}>
        {value}
      </strong>
    </div>
  );
}
