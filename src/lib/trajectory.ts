import type { TranscriptEntry } from "./transcript";

/**
 * A pause at or beyond this length is treated as the session sitting idle
 * rather than working. Agent turns routinely take minutes (long builds, slow
 * tool calls), so the threshold sits well above normal step latency; anything
 * longer is a human walking away, a usage-limit backoff, or a resumed session.
 */
export const IDLE_GAP_MS = 10 * 60_000;

export interface TrajectoryTiming {
  /** Summed spans between consecutive entries, excluding idle and waiting gaps. */
  activeMs: number;
  /** First entry to last entry, idle time included. */
  spanMs: number;
  /** Total time sitting in gaps at or beyond `IDLE_GAP_MS`. */
  idleMs: number;
  /** Number of idle gaps, i.e. how many bursts of work the session splits into. */
  idleGaps: number;
  /**
   * Sub-threshold time between a finished turn and the user's next message:
   * the agent was done and the user had not yet replied. Longer waits count
   * as idle instead.
   */
  waitingMs: number;
}

interface Stamp {
  at: number;
  entry: TranscriptEntry;
  /** Whether this is the entry's start (`occurredAt`) rather than its result. */
  start: boolean;
}

function stamps(entries: TranscriptEntry[]): Stamp[] {
  const values: Stamp[] = [];
  for (const entry of entries) {
    for (const [value, start] of [
      [entry.occurredAt, true],
      [entry.completedAt, false],
    ] as const) {
      if (!value) continue;
      const at = new Date(value).getTime();
      if (!Number.isNaN(at)) values.push({ at, entry, start });
    }
  }
  return values.sort((a, b) => a.at - b.at);
}

/**
 * A turn is finished when the agent's last word before the next user message
 * was a reply rather than a step of work. A user message that follows a tool
 * call or thought cut in mid-turn, so the time before it was still work.
 */
export function isTurnEnd(previous: { kind: string }): boolean {
  return previous.kind === "assistant";
}

/**
 * Splits a transcript's wall-clock span into working, waiting, and idle time.
 *
 * A session's start→end span badly overstates the work: a failed run throttled
 * overnight reports 19h when it worked for 2. Summing only the sub-threshold
 * gaps between entries gives the time the agent was actually stepping — less
 * the pauses where it had finished its turn and was waiting on the user.
 */
export function trajectoryTiming(
  entries: TranscriptEntry[],
): TrajectoryTiming | null {
  const values = stamps(entries);
  if (values.length < 2) return null;
  let activeMs = 0;
  let idleMs = 0;
  let idleGaps = 0;
  let waitingMs = 0;
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    const gap = current.at - previous.at;
    if (gap >= IDLE_GAP_MS) {
      idleMs += gap;
      idleGaps += 1;
    } else if (
      current.start &&
      current.entry.kind === "user" &&
      isTurnEnd(previous.entry)
    ) {
      waitingMs += gap;
    } else {
      activeMs += gap;
    }
  }
  return {
    activeMs,
    spanMs: values[values.length - 1].at - values[0].at,
    idleMs,
    idleGaps,
    waitingMs,
  };
}

/** Milliseconds a tool call took, when its result carried a timestamp. */
export function entryDurationMs(entry: TranscriptEntry): number | null {
  if (!entry.occurredAt || !entry.completedAt) return null;
  const start = new Date(entry.occurredAt).getTime();
  const end = new Date(entry.completedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return end >= start ? end - start : null;
}

/** Compact duration for inline trajectory copy: `420ms`, `3.4s`, `2m 05s`. */
export function shortDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
  const seconds = milliseconds / 1_000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  // Round to whole seconds before splitting: rounding each unit on its own
  // lets a value just under the boundary render as `59.6s` -> `60s` or
  // `4m 60s`.
  const totalSeconds = Math.round(seconds);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60)
    return `${minutes}m ${String(totalSeconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export type RibbonKind =
  "user" | "assistant" | "thinking" | "tool" | "subagent" | "error";

export interface RibbonPoint {
  id: string;
  turnId: string;
  at: number;
  kind: RibbonKind;
  label: string;
}

/** A span inside a burst where the agent had finished and awaited the user. */
export interface RibbonWait {
  startMs: number;
  endMs: number;
}

export interface RibbonBurst {
  startMs: number;
  endMs: number;
  /** Wall-clock length of the burst, waits included. */
  durationMs: number;
  /** Summed length of `waits`; `durationMs - waitingMs` is the work it holds. */
  waitingMs: number;
  waits: RibbonWait[];
  /** Idle time separating this burst from the previous one; 0 for the first. */
  idleBeforeMs: number;
  points: RibbonPoint[];
}

/**
 * Split a session's entries into the runs of work between its idle gaps.
 *
 * Plotted on true wall clock a stalled session is mostly dead space — session
 * 29664 spends 89% of its 19h in four gaps — so the ribbon gives each burst
 * width in proportion to its length and draws the gaps as fixed markers.
 * Within a burst, the sub-threshold pause between a finished turn and the next
 * user message is recorded as a wait so it is not read as work.
 */
export function buildRibbonBursts(
  points: RibbonPoint[],
  idleGapMs: number = IDLE_GAP_MS,
): RibbonBurst[] {
  const sorted = [...points].sort((a, b) => a.at - b.at);
  const bursts: RibbonBurst[] = [];
  for (const point of sorted) {
    const current = bursts[bursts.length - 1];
    if (current && point.at - current.endMs < idleGapMs) {
      const previous = current.points[current.points.length - 1];
      if (
        point.kind === "user" &&
        isTurnEnd(previous) &&
        point.at > current.endMs
      ) {
        current.waits.push({ startMs: current.endMs, endMs: point.at });
        current.waitingMs += point.at - current.endMs;
      }
      current.endMs = point.at;
      current.durationMs = current.endMs - current.startMs;
      current.points.push(point);
      continue;
    }
    bursts.push({
      startMs: point.at,
      endMs: point.at,
      durationMs: 0,
      waitingMs: 0,
      waits: [],
      idleBeforeMs: current ? point.at - current.endMs : 0,
      points: [point],
    });
  }
  return bursts;
}

/** Where a point sits within its burst, 0–1. A zero-length burst sits at 0. */
export function pointOffset(burst: RibbonBurst, point: RibbonPoint): number {
  return timeOffset(burst, point.at);
}

/** Where a moment sits within its burst, 0–1. */
export function timeOffset(burst: RibbonBurst, at: number): number {
  if (burst.durationMs <= 0) return 0;
  return (at - burst.startMs) / burst.durationMs;
}
