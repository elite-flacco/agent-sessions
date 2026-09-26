"use client";

import { ArrowDown, Bot, Brain, Check, Command, User } from "lucide-react";
import { Fragment, useMemo, useRef, useState } from "react";
import { countLabel } from "@/lib/format";
import type { SessionTranscript, TranscriptEntry } from "@/lib/transcript";

const CLAMP_CHARS = 700;

export type TranscriptBlock =
  | { kind: "message"; entry: TranscriptEntry }
  | { kind: "tool-cluster"; entries: TranscriptEntry[] };

export interface TranscriptTurn {
  id: string;
  blocks: TranscriptBlock[];
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
    const isToolish = item.kind === "tool" || item.kind === "result";
    const last = turn.blocks[turn.blocks.length - 1];
    if (isToolish && last?.kind === "tool-cluster") last.entries.push(item);
    else if (isToolish)
      turn.blocks.push({ kind: "tool-cluster", entries: [item] });
    else turn.blocks.push({ kind: "message", entry: item });
  }
  return turns;
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

type KindFilter = "all" | "conversation" | "tools";

function matchesFilter(entry: TranscriptEntry, filter: KindFilter): boolean {
  if (filter === "conversation")
    return (
      entry.kind === "user" ||
      entry.kind === "assistant" ||
      entry.kind === "reasoning"
    );
  if (filter === "tools")
    return entry.kind === "tool" || entry.kind === "result";
  return true;
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
  const endRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () =>
      filter === "all"
        ? transcript.entries
        : transcript.entries.filter((entry) => matchesFilter(entry, filter)),
    [transcript.entries, filter],
  );
  const turns = useMemo(() => buildTurns(filtered), [filtered]);

  return (
    <>
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
          onClick={() =>
            endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" })
          }
        >
          <ArrowDown size={12} />
          Jump to end
        </button>
      </div>
      <div className="transcript-list">
        {filter === "tools" ? (
          <FlatToolRows entries={filtered} />
        ) : (
          <TranscriptTurns turns={turns} />
        )}
        {filtered.length === 0 && (
          <p className="overview-empty">
            No {filter === "tools" ? "tool" : "conversation"} entries in this
            transcript.
          </p>
        )}
        <div ref={endRef} aria-hidden />
      </div>
    </>
  );
}

function firstOccurredAt(turn: TranscriptTurn): string | null {
  for (const block of turn.blocks) {
    const item = block.kind === "message" ? block.entry : block.entries[0];
    if (item?.occurredAt) return item.occurredAt;
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

function TranscriptTurns({ turns }: { turns: TranscriptTurn[] }) {
  // Transcript rows show clock times only, so mark calendar-day changes for
  // sessions that span midnight. Dividers sit between turn blocks.
  let lastDay = "";
  return turns.map((turn) => {
    const occurredAt = firstOccurredAt(turn);
    const day = occurredAt ? new Date(occurredAt).toDateString() : "";
    const divider =
      occurredAt && day && day !== lastDay ? (
        <div className="transcript-day-divider" role="separator">
          {dayLabel(occurredAt)}
        </div>
      ) : null;
    if (day) lastDay = day;
    return (
      <Fragment key={turn.id}>
        {divider}
        <section className="transcript-turn">
          {turn.blocks.map((block, index) =>
            block.kind === "message" ? (
              block.entry.kind === "reasoning" ? (
                <ThinkingBlock key={block.entry.id} entry={block.entry} />
              ) : (
                <MessageBlock key={block.entry.id} entry={block.entry} />
              )
            ) : (
              <ToolCluster
                key={`${turn.id}-cluster-${index}`}
                entries={block.entries}
              />
            ),
          )}
        </section>
      </Fragment>
    );
  });
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

function ToolCluster({ entries }: { entries: TranscriptEntry[] }) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
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
      aria-label={countLabel(entries.length, "tool call")}
    >
      <header>
        <strong>{countLabel(entries.length, "tool call")}</strong>
        <button className="transcript-clamp-toggle" onClick={toggleAll}>
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </header>
      <ToolRows entries={entries} openIds={openIds} onToggle={toggleRow} />
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
      {entries.map((entry) => (
        <ToolRow
          key={entry.id}
          entry={entry}
          open={openIds.has(entry.id)}
          onToggle={onToggle}
        />
      ))}
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
