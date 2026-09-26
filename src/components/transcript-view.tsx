"use client";

import {
  ArrowDown,
  Bot,
  ChevronRight,
  Brain,
  Check,
  Command,
  ListChecks,
  MessageCircleQuestion,
  Sparkles,
  User,
} from "lucide-react";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { countLabel } from "@/lib/format";
import {
  isDelegationCall,
  markerKind,
  parseDecisions,
  parsePhase,
  parsePlanDiff,
} from "@/lib/transcript-markers";
import { entryDurationMs, IDLE_GAP_MS, shortDuration } from "@/lib/trajectory";
import { TrajectoryRibbon } from "./trajectory-ribbon";
import type { SessionTranscript, TranscriptEntry } from "@/lib/transcript";

const CLAMP_CHARS = 700;

/** Breathing room above a turn we scroll to, matching its scroll margin. */
const TURN_SCROLL_OFFSET = 16;

/** Longest hop, in viewport heights, still worth animating. */
const SMOOTH_VIEWPORTS = 2;

/** Where down the viewport a turn counts as the one being read. */
const ACTIVE_TURN_LINE = 0.35;

/**
 * Move the window to `top`. Smooth scrolling is a useful orientation cue over
 * a short hop, but a long transcript is tens of thousands of pixels tall and
 * animating that far just makes the reader wait while content streaks past —
 * so only animate hops worth animating.
 */
function scrollWindowTo(top: number, animate: boolean): void {
  const target = Math.max(0, top);
  const shortHop =
    Math.abs(target - window.scrollY) < window.innerHeight * SMOOTH_VIEWPORTS;
  window.scrollTo({
    top: target,
    behavior: animate && shortHop ? "smooth" : "auto",
  });
}

/**
 * Scroll the page to a turn. `scrollIntoView` also scrolls every scrollable
 * ancestor — including the outline rail — which made the landing position
 * depend on where the rail happened to be scrolled, so compute the offset and
 * move the window itself.
 */
function scrollToTurn(id: string, animate: boolean): void {
  const node = document.getElementById(id);
  if (!node) return;
  const top = node.getBoundingClientRect().top + window.scrollY;
  scrollWindowTo(top - TURN_SCROLL_OFFSET, animate);
}

const EMPTY_NOUN: Record<KindFilter, string> = {
  all: "readable",
  conversation: "conversation",
  tools: "tool",
  errors: "failed",
};

export type TranscriptBlock =
  | { kind: "message"; entry: TranscriptEntry }
  | { kind: "marker"; entry: TranscriptEntry }
  | { kind: "tool-cluster"; entries: TranscriptEntry[] };

export interface TranscriptTurn {
  id: string;
  blocks: TranscriptBlock[];
  /** Cut out of one long turn, so its label comes from the agent, not a user. */
  segmented?: boolean;
}

/**
 * Groups the flat entry list into chat-style turns. A turn starts at each user
 * entry; entries before the first user entry form a leading turn. Consecutive
 * tool/result entries merge into a single tool-cluster block.
 */
export function buildTurns(entries: TranscriptEntry[]): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  let openIndex = -1;
  for (const item of entries) {
    if (item.kind === "user" || openIndex === -1) {
      turns.push({ id: `turn-${item.id}`, blocks: [] });
      openIndex = turns.length - 1;
    }
    const turn = turns[openIndex];
    // Plan/decision/phase calls break out of the cluster: they describe the
    // trajectory rather than doing work, and folding them into a run of tool
    // rows is what buried them.
    if (markerKind(item)) {
      turn.blocks.push({ kind: "marker", entry: item });
      continue;
    }
    // Thinking is part of the work, not a break in it. Left as its own block
    // it split every tool run in two, which is what turned an unattended run
    // into a wall of ungrouped rows.
    const isToolish =
      item.kind === "tool" ||
      item.kind === "result" ||
      item.kind === "reasoning";
    const last = turn.blocks[turn.blocks.length - 1];
    if (isToolish && last?.kind === "tool-cluster") last.entries.push(item);
    else if (isToolish)
      turn.blocks.push({ kind: "tool-cluster", entries: [item] });
    else turn.blocks.push({ kind: "message", entry: item });
  }
  return turns;
}

/** An assistant message block, which is where the agent says what it is doing. */
function isNarration(block: TranscriptBlock): boolean {
  return block.kind === "message" && block.entry.kind === "assistant";
}

/**
 * Splits a lone turn at the agent's own narration. An unattended run has no
 * user entries after the first, so it renders as one unsplittable turn and the
 * outline has nothing to list — the longest transcripts losing the only
 * affordance for navigating them. The agent's messages are the spine it
 * already wrote; blocks before the first one ride along with it.
 */
export function segmentTurns(turns: TranscriptTurn[]): TranscriptTurn[] {
  // Only a lone turn is unnavigable; a conversation already has its spine.
  return turns.length === 1 ? segmentOne(turns[0]) : turns;
}

function segmentOne(turn: TranscriptTurn): TranscriptTurn[] {
  const starts = turn.blocks.flatMap((block, index) =>
    isNarration(block) ? [index] : [],
  );
  // One narration is not a spine, and splitting there would only add chrome.
  if (starts.length < 2) return [turn];
  const segments: TranscriptTurn[] = [];
  starts.forEach((start, order) => {
    const from = order === 0 ? 0 : start;
    const to =
      order === starts.length - 1 ? turn.blocks.length : starts[order + 1];
    const blocks = turn.blocks.slice(from, to);
    const lead = blockEntries(blocks[0])[0];
    segments.push({
      id: order === 0 ? turn.id : `turn-${lead.id}`,
      blocks,
      segmented: true,
    });
  });
  return segments;
}

const PREVIEW_KEYS = [
  "file_path",
  "path",
  "command",
  "cmd",
  "url",
  "pattern",
  "query",
] as const;
const PREVIEW_MAX_CHARS = 80;

function previewRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncatePreview(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > PREVIEW_MAX_CHARS
    ? `${collapsed.slice(0, PREVIEW_MAX_CHARS - 1)}…`
    : collapsed;
}

/** One-line ellipsized preview of a tool entry's input for cluster rows. */
export function toolPreview(entry: TranscriptEntry): string {
  if (!entry.input) return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(entry.input);
  } catch {
    parsed = undefined;
  }
  if (previewRecord(parsed)) {
    for (const key of PREVIEW_KEYS) {
      const value = parsed[key];
      if (typeof value === "string" && value.length)
        return truncatePreview(value);
      if (typeof value === "number" || typeof value === "boolean")
        return truncatePreview(String(value));
    }
    const firstString = Object.values(parsed).find(
      (value) => typeof value === "string" && value.length,
    );
    if (typeof firstString === "string") return truncatePreview(firstString);
  }
  return truncatePreview(entry.input);
}

type KindFilter = "all" | "conversation" | "tools" | "errors";

function matchesFilter(entry: TranscriptEntry, filter: KindFilter): boolean {
  if (filter === "conversation")
    return (
      entry.kind === "user" ||
      entry.kind === "assistant" ||
      entry.kind === "reasoning"
    );
  if (filter === "tools")
    return entry.kind === "tool" || entry.kind === "result";
  if (filter === "errors") return entry.isError;
  return true;
}

/** Filters that list entries flat rather than as chat-style turns. */
function isFlatFilter(filter: KindFilter): boolean {
  return filter === "tools" || filter === "errors";
}

function shortTime(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fullTime(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function TranscriptView({
  transcript,
}: {
  transcript: SessionTranscript;
}) {
  const [filter, setFilter] = useState<KindFilter>("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      filter === "all"
        ? transcript.entries
        : transcript.entries.filter((entry) => matchesFilter(entry, filter)),
    [transcript.entries, filter],
  );
  const turns = useMemo(() => buildTurns(filtered), [filtered]);
  // The ribbon reads turns; the log and the outline read sections, so an
  // unattended run still gets a spine to navigate by.
  const sections = useMemo(() => segmentTurns(turns), [turns]);
  const summaries = useMemo(() => sections.map(summarizeTurn), [sections]);
  const flat = isFlatFilter(filter);
  const showOutline = !flat && summaries.length > 1;

  const toggleTurn = useCallback((id: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const jumpTo = useCallback((id: string) => {
    // Expand first: a collapsed target would scroll to a header with nothing
    // under it. Flush that render before measuring, since expanding moves
    // everything below the target.
    flushSync(() => {
      setCollapsed((previous) => {
        if (!previous.has(id)) return previous;
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    });
    scrollToTurn(id, true);
    // Mark it now rather than waiting for the scroll position to report back:
    // the reader asked for this turn, so the rail should say so immediately.
    setActiveId(id);
    history.replaceState(null, "", `#${id}`);
  }, []);

  // Honour a turn anchor on load so a linked turn opens where it was linked.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id.startsWith("turn-")) scrollToTurn(id, false);
  }, []);

  // Track which turn is in view so the outline says where you are. An
  // IntersectionObserver only fires when a threshold is crossed, and a turn
  // can be taller than the viewport it is meant to activate in, so read
  // positions on scroll instead: the active turn is the last one that has
  // started above the reading line.
  useEffect(() => {
    if (!showOutline) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = window.innerHeight * ACTIVE_TURN_LINE;
      let current: string | null = null;
      for (const summary of summaries) {
        const node = document.getElementById(summary.id);
        if (!node) continue;
        if (node.getBoundingClientRect().top <= line) current = summary.id;
        else break;
      }
      setActiveId(current ?? summaries[0]?.id ?? null);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [summaries, showOutline]);

  return (
    <>
      {!flat && <TrajectoryRibbon turns={turns} onSelect={jumpTo} />}
      <div className="transcript-controls">
        <div
          className="transcript-filter"
          role="group"
          aria-label="Filter transcript entries"
        >
          {(
            [
              ["all", "All"],
              ["conversation", "Conversation"],
              ["tools", "Tools"],
              ["errors", "Errors"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={
                filter === value
                  ? "transcript-filter-btn transcript-filter-active"
                  : "transcript-filter-btn"
              }
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="transcript-filter-btn"
          onClick={() => scrollWindowTo(document.body.scrollHeight, true)}
        >
          <ArrowDown size={12} />
          Jump to end
        </button>
      </div>
      <div
        className={
          showOutline
            ? "transcript-layout transcript-layout-outlined"
            : "transcript-layout"
        }
      >
        <div className="transcript-list">
          {flat ? (
            <FlatToolRows entries={filtered} />
          ) : (
            <TranscriptTurns
              turns={sections}
              summaries={summaries}
              collapsed={collapsed}
              onToggle={toggleTurn}
              showHeaders={summaries.length > 1}
            />
          )}
          {filtered.length === 0 && (
            <p className="overview-empty">
              No {EMPTY_NOUN[filter]} entries in this transcript.
            </p>
          )}
        </div>
        {showOutline && (
          <TranscriptOutline
            summaries={summaries}
            activeId={activeId}
            onSelect={jumpTo}
          />
        )}
      </div>
    </>
  );
}

function TranscriptOutline({
  summaries,
  activeId,
  onSelect,
}: {
  summaries: TurnSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="transcript-outline" aria-label="Session outline">
      <div className="transcript-outline-inner">
        <span className="eyebrow">
          {countLabel(
            summaries.length,
            summaries[0]?.segmented ? "step" : "turn",
          )}
        </span>
        <ol>
          {summaries.map((summary) => (
            <li key={summary.id}>
              <button
                className={
                  summary.id === activeId
                    ? "transcript-outline-btn transcript-outline-current"
                    : "transcript-outline-btn"
                }
                aria-current={summary.id === activeId ? "true" : undefined}
                onClick={() => onSelect(summary.id)}
              >
                <span className="transcript-outline-label">
                  {summary.label}
                </span>
                <span className="transcript-outline-meta">
                  <TurnMeta summary={summary} />
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}

function TurnMeta({ summary }: { summary: TurnSummary }) {
  const bits: string[] = [];
  if (summary.durationMs !== null && summary.durationMs >= 1_000)
    bits.push(shortDuration(summary.durationMs));
  if (summary.toolCalls) bits.push(countLabel(summary.toolCalls, "call"));
  if (summary.subagents) bits.push(countLabel(summary.subagents, "subagent"));
  return (
    <>
      {bits.join(" · ")}
      {summary.errors > 0 && (
        <span className="transcript-outline-errors">
          {" "}
          {countLabel(summary.errors, "error")}
        </span>
      )}
    </>
  );
}

export interface TurnSummary {
  id: string;
  index: number;
  label: string;
  occurredAt: string | null;
  durationMs: number | null;
  toolCalls: number;
  subagents: number;
  errors: number;
  /** Cut from one long turn, so it is a step in it rather than a turn of its own. */
  segmented: boolean;
}

const TURN_LABEL_CHARS = 72;

function truncateLabel(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > TURN_LABEL_CHARS
    ? `${collapsed.slice(0, TURN_LABEL_CHARS - 1)}…`
    : collapsed;
}

/**
 * Per-turn roll-up for the outline. A 472-entry transcript is 12 turns, so the
 * turn list is the spine you actually navigate by; these are the numbers that
 * say which turn is worth opening.
 */
export function summarizeTurn(
  turn: TranscriptTurn,
  index: number,
): TurnSummary {
  const entries = turn.blocks.flatMap(blockEntries);
  const lead = turn.segmented
    ? entries.find((entry) => entry.kind === "assistant" && entry.content)
    : entries.find((entry) => entry.kind === "user");
  const label = lead?.content
    ? truncateLabel(lead.content)
    : index === 0
      ? "Session start"
      : turn.segmented
        ? `Step ${index + 1}`
        : `Turn ${index + 1}`;
  const start = firstOccurredAt(turn);
  const end = lastOccurredAt(turn);
  const durationMs =
    start && end ? new Date(end).getTime() - new Date(start).getTime() : null;
  return {
    id: turn.id,
    index,
    label,
    occurredAt: start,
    durationMs: durationMs !== null && durationMs >= 0 ? durationMs : null,
    segmented: turn.segmented ?? false,
    toolCalls: entries.filter((entry) => entry.kind === "tool").length,
    subagents: entries.filter(isDelegationCall).length,
    errors: entries.filter((entry) => entry.isError).length,
  };
}

/** Every entry a block holds, in transcript order. */
export function blockEntries(block: TranscriptBlock): TranscriptEntry[] {
  return block.kind === "tool-cluster" ? block.entries : [block.entry];
}

function firstOccurredAt(turn: TranscriptTurn): string | null {
  for (const block of turn.blocks) {
    const item = blockEntries(block)[0];
    if (item?.occurredAt) return item.occurredAt;
  }
  return null;
}

function lastOccurredAt(turn: TranscriptTurn): string | null {
  for (let index = turn.blocks.length - 1; index >= 0; index -= 1) {
    for (const item of [...blockEntries(turn.blocks[index])].reverse()) {
      if (item.completedAt) return item.completedAt;
      if (item.occurredAt) return item.occurredAt;
    }
  }
  return null;
}

function dayLabel(value: string): string {
  return new Date(value).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function TranscriptTurns({
  turns,
  summaries,
  collapsed,
  onToggle,
  showHeaders,
}: {
  turns: TranscriptTurn[];
  summaries: TurnSummary[];
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  showHeaders: boolean;
}) {
  // Transcript rows show clock times only, so mark calendar-day changes for
  // sessions that span midnight, and call out the long pauses between turns —
  // a stalled or resumed session otherwise reads as continuous work.
  let lastDay = "";
  let previousEnd: number | null = null;
  return turns.map((turn, index) => {
    const occurredAt = firstOccurredAt(turn);
    const startedAt = occurredAt ? new Date(occurredAt).getTime() : null;
    const day = occurredAt ? new Date(occurredAt).toDateString() : "";
    const idleMs =
      startedAt !== null && previousEnd !== null ? startedAt - previousEnd : 0;
    const parts: string[] = [];
    if (idleMs >= IDLE_GAP_MS) parts.push(`Idle ${shortDuration(idleMs)}`);
    if (occurredAt && day && day !== lastDay) parts.push(dayLabel(occurredAt));
    const divider = parts.length ? (
      <div
        className={
          idleMs >= IDLE_GAP_MS
            ? "transcript-day-divider transcript-divider-idle"
            : "transcript-day-divider"
        }
        role="separator"
      >
        {parts.join(" · ")}
      </div>
    ) : null;
    if (day) lastDay = day;
    const endedAt = lastOccurredAt(turn);
    if (endedAt) {
      const value = new Date(endedAt).getTime();
      if (!Number.isNaN(value)) previousEnd = value;
    }
    const isCollapsed = collapsed.has(turn.id);
    return (
      <Fragment key={turn.id}>
        {divider}
        <section
          className="transcript-turn"
          id={turn.id}
          data-collapsed={isCollapsed ? "true" : undefined}
        >
          {showHeaders && (
            <TurnHeader
              summary={summaries[index]}
              collapsed={isCollapsed}
              onToggle={onToggle}
            />
          )}
          {!isCollapsed &&
            turn.blocks.map((block, blockIndex) =>
              block.kind === "marker" ? (
                <TrajectoryMarker key={block.entry.id} entry={block.entry} />
              ) : block.kind === "message" ? (
                block.entry.kind === "reasoning" ? (
                  <ThinkingBlock key={block.entry.id} entry={block.entry} />
                ) : (
                  <MessageBlock key={block.entry.id} entry={block.entry} />
                )
              ) : (
                <ToolCluster
                  key={`${turn.id}-cluster-${blockIndex}`}
                  entries={block.entries}
                />
              ),
            )}
        </section>
      </Fragment>
    );
  });
}

function TurnHeader({
  summary,
  collapsed,
  onToggle,
}: {
  summary: TurnSummary;
  collapsed: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <button
      className="transcript-turn-header"
      aria-expanded={!collapsed}
      onClick={() => onToggle(summary.id)}
    >
      <ChevronRight size={13} aria-hidden />
      <span className="transcript-turn-index">
        {summary.segmented ? "Step" : "Turn"} {summary.index + 1}
      </span>
      {/* The turn's own label is the heading, so the log and the outline rail
          name a turn the same way whether or not it is folded. */}
      <span className="transcript-turn-label"></span>
      <span className="transcript-turn-meta">
        <TurnMeta summary={summary} />
      </span>
    </button>
  );
}

function TrajectoryMarker({ entry }: { entry: TranscriptEntry }) {
  const kind = markerKind(entry);
  if (kind === "plan") return <PlanMarker entry={entry} />;
  if (kind === "decision") return <DecisionMarker entry={entry} />;
  if (kind === "phase") return <PhaseMarker entry={entry} />;
  return null;
}

function MarkerShell({
  kind,
  icon,
  label,
  occurredAt,
  children,
}: {
  kind: string;
  icon: ReactNode;
  label: string;
  occurredAt: string | null;
  children: ReactNode;
}) {
  return (
    <section className="transcript-marker" data-marker={kind}>
      <header>
        <span className="transcript-marker-glyph" aria-hidden>
          {icon}
        </span>
        <strong className="text-sm">{label}</strong>
        {occurredAt && (
          <time title={fullTime(occurredAt)}>{shortTime(occurredAt)}</time>
        )}
      </header>
      {children}
    </section>
  );
}

function PlanMarker({ entry }: { entry: TranscriptEntry }) {
  const diff = parsePlanDiff(entry);
  if (!diff) return <ToolCluster entries={[entry]} />;
  const rows: { symbol: string; state: string; items: string[] }[] = [
    { symbol: "✓", state: "done", items: diff.completed },
    { symbol: "→", state: "started", items: diff.started },
    { symbol: "+", state: "added", items: diff.added },
  ].filter((row) => row.items.length > 0);
  return (
    <MarkerShell
      kind="plan"
      icon={<ListChecks size={13} />}
      label={`Plan · ${diff.done}/${diff.total}`}
      occurredAt={entry.occurredAt}
    >
      {rows.length ? (
        <ul className="transcript-marker-list">
          {rows.flatMap((row) =>
            row.items.map((item) => (
              <li key={`${row.state}-${item}`} data-state={row.state}>
                <span aria-hidden>{row.symbol}</span>
                <span className="transcript-marker-item">{item}</span>
              </li>
            )),
          )}
        </ul>
      ) : (
        <p className="transcript-marker-note">No change to the plan.</p>
      )}
    </MarkerShell>
  );
}

function DecisionMarker({ entry }: { entry: TranscriptEntry }) {
  const decisions = parseDecisions(entry);
  if (!decisions.length) return <ToolCluster entries={[entry]} />;
  return (
    <MarkerShell
      kind="decision"
      icon={<MessageCircleQuestion size={13} />}
      label="Asked the user"
      occurredAt={entry.occurredAt}
    >
      <dl className="transcript-marker-qa">
        {decisions.map((decision) => (
          <Fragment key={decision.question}>
            <dt>{decision.question}</dt>
            <dd>
              {decision.answer ?? (
                <span className="transcript-marker-note">
                  No answer recorded
                </span>
              )}
            </dd>
          </Fragment>
        ))}
      </dl>
    </MarkerShell>
  );
}

function PhaseMarker({ entry }: { entry: TranscriptEntry }) {
  const phase = parsePhase(entry);
  if (!phase) return <ToolCluster entries={[entry]} />;
  return (
    <MarkerShell
      kind="phase"
      icon={<Sparkles size={13} />}
      label={phase.skill}
      occurredAt={entry.occurredAt}
    >
      {phase.args && <p className="transcript-marker-note">{phase.args}</p>}
    </MarkerShell>
  );
}

function MessageBlock({ entry }: { entry: TranscriptEntry }) {
  const icon = entry.kind === "user" ? <User size={14} /> : <Bot size={14} />;
  return (
    <article className={`transcript-message transcript-message-${entry.kind}`}>
      <header>
        {icon}
        <strong className="text-sm">{entry.title}</strong>
        {entry.occurredAt && (
          <time title={fullTime(entry.occurredAt)}>
            {shortTime(entry.occurredAt)}
          </time>
        )}
      </header>
      {entry.content && <ClampedContent content={entry.content} />}
    </article>
  );
}

function ThinkingBlock({ entry }: { entry: TranscriptEntry }) {
  return (
    <details className="transcript-thinking">
      <summary>
        <Brain size={13} />
        <strong className="text-sm">Thinking</strong>
        <span className="transcript-thinking-preview">
          {truncatePreview(entry.content ?? "") || "—"}
        </span>
        {entry.occurredAt && (
          <time title={fullTime(entry.occurredAt)}>
            {shortTime(entry.occurredAt)}
          </time>
        )}
      </summary>
      {entry.content && <ClampedContent content={entry.content} />}
    </details>
  );
}

/** Header for a work group, which now counts thoughts as well as calls. */
function groupLabel(entries: TranscriptEntry[]): string {
  const thoughts = entries.filter((item) => item.kind === "reasoning").length;
  const calls = entries.length - thoughts;
  const callsLabel = countLabel(calls, "tool call");
  if (!thoughts) return callsLabel;
  if (!calls) return countLabel(thoughts, "thought");
  return `${callsLabel} · ${countLabel(thoughts, "thought")}`;
}

function ToolCluster({ entries }: { entries: TranscriptEntry[] }) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  // Work is scrolled past, not read, so every group starts folded to one line
  // and the reader opens the run they actually want. Uniform beats a size
  // threshold: the log reads as a list of steps at any length.
  const [open, setOpen] = useState(false);
  const allOpen = openIds.size >= entries.length;
  function toggleRow(id: string, open: boolean): void {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function toggleAll(): void {
    setOpenIds(allOpen ? new Set() : new Set(entries.map((item) => item.id)));
  }
  return (
    <section
      className="transcript-tool-cluster"
      aria-label={groupLabel(entries)}
      data-collapsed={open ? undefined : "true"}
    >
      <header>
        <button
          className="transcript-group-toggle"
          aria-expanded={open}
          onClick={() => setOpen((previous) => !previous)}
        >
          <ChevronRight size={13} aria-hidden />
          <strong>{groupLabel(entries)}</strong>
        </button>
        {/* A lone row has nothing to expand *all* of; it opens by itself. */}
        {open && entries.length > 1 && (
          <button className="transcript-clamp-toggle" onClick={toggleAll}>
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        )}
      </header>
      {open && (
        <ToolRows entries={entries} openIds={openIds} onToggle={toggleRow} />
      )}
    </section>
  );
}

function FlatToolRows({ entries }: { entries: TranscriptEntry[] }) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  function toggleRow(id: string, open: boolean): void {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  return (
    <ToolRows entries={entries} openIds={openIds} onToggle={toggleRow} flat />
  );
}

function ToolRows({
  entries,
  openIds,
  onToggle,
  flat,
}: {
  entries: TranscriptEntry[];
  openIds: Set<string>;
  onToggle: (id: string, open: boolean) => void;
  flat?: boolean;
}) {
  return (
    <div
      className={
        flat
          ? "transcript-tool-rows transcript-tool-rows-flat"
          : "transcript-tool-rows"
      }
    >
      {entries.map((entry) =>
        // A thought rides inside the work group but is not a call, so it keeps
        // its own chrome rather than posing as one.
        entry.kind === "reasoning" ? (
          <ThinkingBlock key={entry.id} entry={entry} />
        ) : (
          <ToolRow
            key={entry.id}
            entry={entry}
            open={openIds.has(entry.id)}
            onToggle={onToggle}
          />
        ),
      )}
    </div>
  );
}

function ToolRow({
  entry,
  open,
  onToggle,
}: {
  entry: TranscriptEntry;
  open: boolean;
  onToggle: (id: string, open: boolean) => void;
}) {
  const glyph =
    entry.kind === "tool" ? <Command size={13} /> : <Check size={13} />;
  const durationMs = entryDurationMs(entry);
  return (
    <details
      className="transcript-tool-row"
      data-kind={entry.kind}
      open={open}
      onToggle={(event) =>
        onToggle(entry.id, (event.target as HTMLDetailsElement).open)
      }
    >
      <summary>
        <span className="transcript-tool-glyph" aria-hidden>
          {glyph}
        </span>
        <span className="transcript-tool-name">{entry.title}</span>
        <span className="mono transcript-tool-preview">
          {toolPreview(entry) || "—"}
        </span>
        {entry.isError ? (
          <span className="payload-error">Error</span>
        ) : entry.output != null ? (
          <span
            className="transcript-tool-ok"
            role="img"
            aria-label="succeeded"
          >
            ✓
          </span>
        ) : null}
        {durationMs !== null && (
          <span className="transcript-tool-duration">
            {shortDuration(durationMs)}
          </span>
        )}
        {entry.occurredAt && (
          <time title={fullTime(entry.occurredAt)}>
            {shortTime(entry.occurredAt)}
          </time>
        )}
      </summary>
      <div className="transcript-tool-payload">
        {entry.content && <pre>{entry.content}</pre>}
        {entry.input && (
          <div>
            <span className="transcript-tool-payload-label">Arguments</span>
            <pre>{entry.input}</pre>
          </div>
        )}
        {entry.output && (
          <div>
            <span className="transcript-tool-payload-label">Result</span>
            <pre>{entry.output}</pre>
          </div>
        )}
      </div>
    </details>
  );
}

function ClampedContent({ content }: { content: string }) {
  const [showAll, setShowAll] = useState(false);
  if (content.length <= CLAMP_CHARS)
    return <p className="transcript-content">{content}</p>;
  return (
    <>
      <p className="transcript-content">
        {showAll ? content : `${content.slice(0, CLAMP_CHARS).trimEnd()}…`}
      </p>
      <button
        className="transcript-clamp-toggle"
        onClick={() => setShowAll((value) => !value)}
      >
        {showAll ? "Show less" : "Show all"}
      </button>
    </>
  );
}
