"use client";

import { ArrowDown, Bot, Check, CircleDot, Command, User } from "lucide-react";
import { Fragment, useMemo, useRef, useState } from "react";
import type { SessionTranscript, TranscriptEntry } from "@/lib/transcript";

const CLAMP_CHARS = 700;

type KindFilter = "all" | "conversation" | "tools";

export function TranscriptView({
  transcript,
}: {
  transcript: SessionTranscript;
}) {
  const [filter, setFilter] = useState<KindFilter>("all");
  const endRef = useRef<HTMLDivElement>(null);

  const entries = useMemo(() => {
    if (filter === "conversation")
      return transcript.entries.filter(
        (entry) => entry.kind === "user" || entry.kind === "assistant",
      );
    if (filter === "tools")
      return transcript.entries.filter(
        (entry) => entry.kind === "tool" || entry.kind === "result",
      );
    return transcript.entries;
  }, [transcript.entries, filter]);

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
        <TranscriptEntries entries={entries} />
        {entries.length === 0 && (
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

function TranscriptEntries({ entries }: { entries: TranscriptEntry[] }) {
  // Transcript rows show clock times only, so mark calendar-day changes for
  // sessions that span midnight.
  let lastDay = "";
  return entries.map((entry) => {
    let divider = null;
    if (entry.occurredAt) {
      const day = new Date(entry.occurredAt).toDateString();
      if (lastDay && day !== lastDay) {
        divider = (
          <div className="transcript-day-divider" role="separator">
            {new Date(entry.occurredAt).toLocaleDateString([], {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </div>
        );
      }
      lastDay = day;
    }
    return (
      <Fragment key={entry.id}>
        {divider}
        <TranscriptRow entry={entry} />
      </Fragment>
    );
  });
}

function TranscriptRow({ entry }: { entry: TranscriptEntry }) {
  const icon =
    entry.kind === "user" ? (
      <User size={15} />
    ) : entry.kind === "assistant" ? (
      <Bot size={15} />
    ) : entry.kind === "tool" ? (
      <Command size={15} />
    ) : (
      <Check size={15} />
    );
  return (
    <article className={`transcript-entry transcript-${entry.kind}`}>
      <div className="transcript-icon">{icon}</div>
      <div className="transcript-body">
        <header>
          <strong>{entry.title}</strong>
          {entry.isError && <span className="payload-error">Error</span>}
          {entry.occurredAt && (
            <time>
              {new Date(entry.occurredAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </time>
          )}
        </header>
        {entry.content && <ClampedContent content={entry.content} />}
        {entry.input && <Payload label="Arguments" value={entry.input} />}
        {entry.output && <Payload label="Result" value={entry.output} />}
      </div>
    </article>
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
        {showAll
          ? "Show less"
          : `Show all ${content.length.toLocaleString()} characters`}
      </button>
    </>
  );
}

function Payload({ label, value }: { label: string; value: string }) {
  return (
    <details className="payload-disclosure">
      <summary>
        <CircleDot size={11} />
        {label}
      </summary>
      <pre>{value}</pre>
    </details>
  );
}
