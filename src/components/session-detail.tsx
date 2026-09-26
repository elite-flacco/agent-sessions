import { ArrowLeft, Command, Users } from "lucide-react";
import Link from "next/link";
import {
  absoluteTime,
  countLabel,
  elapsed,
  formatCostUsd,
  formatTokens,
  relativeTime,
  runtime,
} from "@/lib/format";
import { childSessionsNoun, costSourceLabels } from "@/lib/labels";
import type {
  SessionDetail,
  SessionListItem,
  SessionUsageDetail,
} from "@/lib/queries";
import { trajectoryTiming } from "@/lib/trajectory";
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

function endedLabel(session: SessionDetail): string | null {
  if (!session.endedAt) return null;
  return `Ended ${absoluteTime(session.endedAt)}`;
}

/** Main-agent/subagent split, folded under the total rather than given cells
 * of its own — a variable cell count leaves the strip's last row ragged. */
function costSplit(usage: SessionUsageDetail): string | undefined {
  const main = usage.costUsd;
  const sub = usage.subagentCostUsd;
  if (main === null && sub === null) return undefined;
  const parts: string[] = [];
  if (main !== null) parts.push(`${formatCostUsd(main)} main`);
  if (sub !== null) parts.push(`${formatCostUsd(sub)} delegated`);
  return parts.join(" · ");
}

/** Diff impact, when the provider exposed edit calls to count. */
function changeSummary(session: SessionDetail): string | null {
  if (session.filesChanged === null) return null;
  return `${countLabel(session.filesChanged, "file")}`;
}

function changeNote(session: SessionDetail): string | undefined {
  const added = session.additions ?? 0;
  const removed = session.deletions ?? 0;
  if (!added && !removed) return undefined;
  return `+${added} / -${removed} lines`;
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
  // Start→end wall clock badly overstates the work on any session that stalled
  // or was resumed, so lead with the time the agent was actually stepping and
  // keep waiting, idle, and the raw span as context.
  const timing = trajectoryTiming(transcript.entries);
  const span = elapsed(session.startedAt, session.endedAt ?? session.updatedAt);
  const ended = endedLabel(session);
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
          {ended && <span className="text-muted-foreground">{ended}</span>}
          <strong className="text-lg" title="Time the agent spent working">
            {timing ? `${runtime(timing.activeMs)} active` : span}
          </strong>
          {timing && (timing.idleGaps > 0 || timing.waitingMs >= 60_000) && (
            <span className="text-muted-foreground">
              {[
                timing.waitingMs >= 60_000 &&
                  `${runtime(timing.waitingMs)} waiting on you`,
                timing.idleGaps > 0 &&
                  `${runtime(timing.idleMs)} idle across ${countLabel(timing.idleGaps, "gap")}`,
                `${span} elapsed`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
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
        <Detail
          label="Files changed"
          value={changeSummary(session) ?? "Unavailable"}
          note={changeNote(session)}
        />
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
          note={subagents.length > 0 ? costSplit(usage) : undefined}
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
            <h3 id="transcript-title">Session log</h3>
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

const MISSING_VALUES = new Set(["Unavailable", "None"]);

function Detail({
  label,
  value,
  mono,
  note,
}: {
  label: string;
  value: string;
  mono?: boolean;
  note?: string;
}) {
  // A placeholder should not carry the same weight as a real measurement.
  const missing = MISSING_VALUES.has(value);
  const classes = ["truncate", "text-xs"];
  if (mono && !missing) classes.push("mono");
  if (missing) classes.push("text-muted-foreground");
  return (
    <div>
      <span className="eyebrow">{label}</span>
      <strong className={classes.join(" ")}>{value}</strong>
      {note && <span className="truncate text-muted-foreground">{note}</span>}
    </div>
  );
}
