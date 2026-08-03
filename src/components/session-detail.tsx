import { ArrowLeft, Command, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import {
  absoluteTime,
  elapsed,
  formatCostUsd,
  formatTokens,
  relativeTime,
} from "@/lib/format";
import { costSourceLabels, providerBadges, providerLabels } from "@/lib/labels";
import type {
  SessionDetail,
  SessionListItem,
  SessionUsageDetail,
} from "@/lib/queries";
import type { SessionTranscript } from "@/lib/transcript";
import { StatusLabel } from "./status-label";
import { TranscriptView } from "./transcript-view";
import styles from "./session-detail.module.css";

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
    <section className={`relay-content ${styles.sessionDetailPage}`}>
      <Link className={styles.backLink} href="/sessions">
        <ArrowLeft size={14} />
        Back to sessions
      </Link>

      <header className={styles.detailPageHeader}>
        <div>
          <span className={`mono ${styles.detailSessionId}`}>
            {session.provider.toUpperCase()} · {session.externalId.slice(0, 12)}
          </span>
          <h1>{session.title}</h1>
          <div className="inspector-badges">
            <span className={`badge ${providerBadges[session.provider]}`}>
              {providerLabels[session.provider]}
            </span>
            <StatusLabel
              status={session.status}
              reason={session.statusReason}
            />
          </div>
        </div>
        <div className={styles.detailTime}>
          <span title={relativeTime(session.startedAt)}>
            Started {absoluteTime(session.startedAt)}
          </span>
          <strong>
            {elapsed(session.startedAt, session.endedAt ?? session.updatedAt)}
          </strong>
        </div>
      </header>

      {parent && (
        <div className={`${styles.sessionParentLink} card`}>
          <Users size={16} />
          <div>
            <span className="eyebrow">Main session</span>
            <Link href={`/sessions/${parent.id}`}>{parent.title}</Link>
          </div>
        </div>
      )}

      <div
        className={`${styles.sessionDetailGrid} card`}
        aria-label="Session details"
      >
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
          className={`${styles.sessionChildren} card`}
          aria-labelledby="subagents-title"
        >
          <header>
            <div>
              <span className="eyebrow">Delegated work</span>
              <h2 id="subagents-title">Subagents</h2>
            </div>
            <span>{subagents.length} sessions</span>
          </header>
          <div className={styles.sessionChildrenList}>
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
                <StatusLabel
                  status={child.status}
                  reason={child.statusReason}
                />
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className={styles.payloadNotice}>
        <ShieldCheck size={16} />
        <p>
          This transcript is read from local provider storage on demand. Common
          credentials are redacted, raw reasoning records are excluded, and
          payloads are not copied into Relay’s database. Provider-injected
          context may still appear inside user or assistant messages.
        </p>
      </div>

      <section
        className={styles.transcriptSection}
        aria-labelledby="transcript-title"
      >
        <header className={styles.transcriptHeading}>
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
