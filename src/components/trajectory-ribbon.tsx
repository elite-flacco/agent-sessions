"use client";

import type { MouseEvent } from "react";
import { Fragment, useMemo } from "react";
import { isDelegationCall } from "@/lib/transcript-markers";
import type { TranscriptEntry } from "@/lib/transcript";
import type { RibbonKind, RibbonPoint } from "@/lib/trajectory";
import {
  buildRibbonBursts,
  pointOffset,
  shortDuration,
  timeOffset,
} from "@/lib/trajectory";
import { blockEntries, type TranscriptTurn } from "./transcript-view";

/** Narrowest a burst may get, so a short burst stays clickable. */
const MIN_BURST_GROW = 0.06;

const KIND_LABELS: Record<RibbonKind, string> = {
  user: "You",
  assistant: "Assistant",
  thinking: "Thinking",
  tool: "Tool call",
  subagent: "Subagent",
  error: "Error",
};

function ribbonKind(entry: TranscriptEntry): RibbonKind {
  if (entry.isError) return "error";
  if (isDelegationCall(entry)) return "subagent";
  if (entry.kind === "user") return "user";
  if (entry.kind === "assistant") return "assistant";
  if (entry.kind === "reasoning") return "thinking";
  return "tool";
}

function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toPoints(turns: TranscriptTurn[]): RibbonPoint[] {
  return turns.flatMap((turn) =>
    turn.blocks.flatMap(blockEntries).flatMap((entry) => {
      if (!entry.occurredAt) return [];
      const at = new Date(entry.occurredAt).getTime();
      if (Number.isNaN(at)) return [];
      const kind = ribbonKind(entry);
      return [
        {
          id: entry.id,
          turnId: turn.id,
          at,
          kind,
          label: `${KIND_LABELS[kind]} · ${entry.title} · ${clockTime(at)}`,
        },
      ];
    }),
  );
}

/**
 * A compressed timeline of the whole session: one tick per entry, placed by
 * real time and coloured by what it was. It answers "where did the work
 * happen" at a glance, which a linear log cannot.
 */
export function TrajectoryRibbon({
  turns,
  onSelect,
}: {
  turns: TranscriptTurn[];
  onSelect: (turnId: string) => void;
}) {
  const bursts = useMemo(() => buildRibbonBursts(toPoints(turns)), [turns]);
  const spanMs = bursts.reduce((total, burst) => total + burst.durationMs, 0);
  const waitingMs = bursts.reduce((total, burst) => total + burst.waitingMs, 0);
  const workingMs = spanMs - waitingMs;
  if (bursts.length < 2 && !spanMs) return null;

  /** Map a click's position along a burst to the nearest entry's turn. */
  function selectAt(
    event: MouseEvent<HTMLButtonElement>,
    burstIndex: number,
  ): void {
    const burst = bursts[burstIndex];
    const box = event.currentTarget.getBoundingClientRect();
    // A keyboard activation reports no coordinates, which lands on 0 — the
    // start of the burst — and that is the right target for one.
    const fraction = box.width ? (event.clientX - box.left) / box.width : 0;
    let nearest = burst.points[0];
    let best = Number.POSITIVE_INFINITY;
    for (const point of burst.points) {
      const distance = Math.abs(pointOffset(burst, point) - fraction);
      if (distance < best) {
        best = distance;
        nearest = point;
      }
    }
    if (nearest) onSelect(nearest.turnId);
  }

  return (
    <figure className="trajectory-ribbon" aria-label="Session activity">
      <div className="trajectory-ribbon-track">
        {bursts.map((burst, index) => (
          <Fragment key={burst.startMs}>
            {burst.idleBeforeMs > 0 && (
              <div className="trajectory-gap">
                <span>{shortDuration(burst.idleBeforeMs)} idle</span>
              </div>
            )}
            <button
              type="button"
              className="trajectory-burst"
              style={{
                flexGrow: Math.max(
                  MIN_BURST_GROW,
                  spanMs ? burst.durationMs / spanMs : 1,
                ),
              }}
              title={`${shortDuration(burst.durationMs - burst.waitingMs)} of work from ${clockTime(burst.startMs)}`}
              onClick={(event) => selectAt(event, index)}
            >
              {/* Drawn to scale like the ticks, but marked as the user's
                  time: the turn had ended, so the blank is not work. */}
              {burst.waits.map((wait) => (
                <span
                  key={wait.startMs}
                  className="trajectory-wait"
                  style={{
                    left: `${timeOffset(burst, wait.startMs) * 100}%`,
                    width: `${(timeOffset(burst, wait.endMs) - timeOffset(burst, wait.startMs)) * 100}%`,
                  }}
                  title={`Turn ended · waiting on you ${shortDuration(wait.endMs - wait.startMs)}`}
                />
              ))}
              {burst.points.map((point) => (
                <span
                  key={point.id}
                  className="trajectory-tick"
                  data-kind={point.kind}
                  style={{ left: `${pointOffset(burst, point) * 100}%` }}
                  title={point.label}
                />
              ))}
            </button>
          </Fragment>
        ))}
      </div>
      <figcaption>
        {shortDuration(workingMs)} of work
        {bursts.length > 1 ? ` across ${bursts.length} bursts` : ""}
        {waitingMs > 0 ? ` · ${shortDuration(waitingMs)} waiting on you` : ""}
        {bursts.length > 1 ? " · idle time compressed" : ""}
      </figcaption>
    </figure>
  );
}
