import type { ScheduledTask } from "./types";

const DAY_NAMES: Record<string, string> = {
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
  SU: "Sunday",
};

function parsePairs(raw: string): Map<string, string[]> {
  // rrule allows repeated keys (BYDAY=MO;BYDAY=WE) — collect all values per key.
  const map = new Map<string, string[]>();
  for (const part of raw.split(";")) {
    const [key, value] = part.split("=");
    if (!key || value === undefined) continue;
    const list = map.get(key.toUpperCase());
    if (list) list.push(value);
    else map.set(key.toUpperCase(), [value]);
  }
  return map;
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Best-effort humanizer for the rrule subset Codex automations emit.
 * Returns undefined when the input isn't a supported rrule so callers can
 * fall back to the raw schedule string. Time is wall-clock local (24h).
 */
export function humanizeSchedule(raw: string): string | undefined {
  if (!raw.trim()) return undefined;
  const pairs = parsePairs(raw);
  const freq = pairs.get("FREQ")?.[0]?.toUpperCase();
  const hour = Number.parseInt(pairs.get("BYHOUR")?.[0] ?? "0", 10);
  const minute = Number.parseInt(pairs.get("BYMINUTE")?.[0] ?? "0", 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return undefined;
  const time = formatTime(hour, minute);

  if (freq === "DAILY") return `Daily at ${time}`;

  if (freq === "WEEKLY") {
    const days = pairs.get("BYDAY") ?? [];
    const named = days
      .map((d) => DAY_NAMES[d.toUpperCase()])
      .filter((d): d is string => Boolean(d));
    if (named.length === 0) return undefined;
    const pluralized = named.map((d) => `${d}s`);
    return `${pluralized.join(", ")} at ${time}`;
  }

  if (freq === "MONTHLY") {
    const monthDay = Number.parseInt(pairs.get("BYMONTHDAY")?.[0] ?? "", 10);
    if (Number.isNaN(monthDay)) return undefined;
    return `Monthly on day ${monthDay} at ${time}`;
  }

  return undefined;
}

/**
 * Sort rank for a scheduled task: `[activeRank, frequencyRank, timeRank]`.
 * Active tasks sort before inactive; within the same active state, more
 * frequent cadences (daily < weekly < monthly) sort first; within the same
 * cadence, earlier wall-clock times sort first. Frequency bands mirror
 * `humanizeSchedule` exactly — no new rrule parsing is introduced.
 */
export function scheduledTaskSortKey(
  task: ScheduledTask,
): [number, number, number] {
  const activeRank = task.status === "active" ? 0 : 1;

  let frequencyRank = 3;
  if (task.scheduleRaw && !task.scheduleMissing) {
    const freq = parsePairs(task.scheduleRaw).get("FREQ")?.at(0)?.toUpperCase();
    if (freq === "DAILY") frequencyRank = 0;
    else if (freq === "WEEKLY") frequencyRank = 1;
    else if (freq === "MONTHLY") frequencyRank = 2;
  }

  let timeRank = 0;
  if (task.scheduleRaw) {
    const pairs = parsePairs(task.scheduleRaw);
    const hour = Number.parseInt(pairs.get("BYHOUR")?.at(0) ?? "0", 10);
    const minute = Number.parseInt(pairs.get("BYMINUTE")?.at(0) ?? "0", 10);
    if (!Number.isNaN(hour) && !Number.isNaN(minute)) {
      timeRank = hour * 60 + minute;
    }
  }

  return [activeRank, frequencyRank, timeRank];
}

/**
 * Comparator for `Array.sort` that orders tasks by their sort key.
 */
export function compareScheduledTasks(
  a: ScheduledTask,
  b: ScheduledTask,
): number {
  const [aa, af, at] = scheduledTaskSortKey(a);
  const [ba, bf, bt] = scheduledTaskSortKey(b);
  return aa - ba || af - bf || at - bt;
}
