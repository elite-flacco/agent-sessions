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
  // Some sources include the RFC 5545 "RRULE:" prefix; strip it so FREQ etc.
  // parse correctly regardless of which form the provider stored.
  const stripped = raw.replace(/^RRULE:/i, "");
  const map = new Map<string, string[]>();
  for (const part of stripped.split(";")) {
    const [key, value] = part.split("=");
    if (!key || value === undefined) continue;
    const list = map.get(key.toUpperCase());
    if (list) list.push(value);
    else map.set(key.toUpperCase(), [value]);
  }
  return map;
}

function formatTime(hour: number, minute: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/**
 * Best-effort humanizer for the rrule subset Codex automations emit.
 * Returns undefined when the input isn't a supported rrule so callers can
 * fall back to the raw schedule string. Time is wall-clock local, rendered
 * 12-hour with an AM/PM suffix so noon and midnight stay unambiguous.
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

const CRON_DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const CRON_MONTH_NAMES = [
  "",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

interface CronSchedule {
  /** Minute-field step (wildcard with an /N step), the shape interval automations store. */
  minuteStep?: number;
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
}

/**
 * Parses one 5-field cron field (wildcards, wildcard steps, single values,
 * ranges, and comma lists of those) into its expanded value list. Returns
 * undefined for anything richer (names, `L`/`W` qualifiers, malformed input)
 * so callers fall back to the raw expression.
 */
function parseCronField(
  field: string,
  min: number,
  max: number,
): number[] | undefined {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const stepped = part.match(/^(.+?)\/(\d+)$/);
    const base = stepped ? stepped[1] : part;
    const step = stepped ? Number(stepped[2]) : 1;
    if (!Number.isInteger(step) || step < 1) return undefined;
    let lo = min;
    let hi = max;
    if (base !== "*" && base !== "") {
      const range = base.split("-");
      if (range.length > 2) return undefined;
      const start = Number(range[0]);
      const end = range.length === 2 ? Number(range[1]) : start;
      if (!Number.isInteger(start) || !Number.isInteger(end)) return undefined;
      if (start < min || end > max || start > end) return undefined;
      lo = start;
      hi = end;
    }
    for (let value = lo; value <= hi; value += step) values.add(value);
  }
  return values.size ? [...values].sort((a, b) => a - b) : undefined;
}

function parseCron(raw: string): CronSchedule | undefined {
  const fields = raw.trim().split(/\s+/);
  if (fields.length !== 5) return undefined;
  const minuteStep = fields[0].match(/^\*\/(\d+)$/);
  const minutes = parseCronField(fields[0], 0, 59);
  const hours = parseCronField(fields[1], 0, 23);
  const daysOfMonth = parseCronField(fields[2], 1, 31);
  const months = parseCronField(fields[3], 1, 12);
  const daysOfWeek = parseCronField(fields[4], 0, 7);
  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) {
    return undefined;
  }
  return {
    minuteStep: minuteStep ? Number(minuteStep[1]) : undefined,
    minutes,
    hours,
    daysOfMonth,
    months,
    // Cron accepts both 0 and 7 for Sunday.
    daysOfWeek: [...new Set(daysOfWeek.map((day) => day % 7))].sort(
      (a, b) => a - b,
    ),
  };
}

function isFullRange(values: number[], min: number, max: number): boolean {
  return (
    values.length === max - min + 1 &&
    values[0] === min &&
    values.at(-1) === max
  );
}

/**
 * Best-effort humanizer for the 5-field cron subset Zcode v2 automations emit
 * (interval, hourly, daily, weekday-list, day-of-month, and pinned-date
 * shapes). Returns undefined for unsupported expressions so callers fall back
 * to the raw cron string.
 */
export function humanizeCron(raw: string): string | undefined {
  if (!raw.trim()) return undefined;
  const cron = parseCron(raw);
  if (!cron) return undefined;
  const fullHours = isFullRange(cron.hours, 0, 23);
  const fullDays = isFullRange(cron.daysOfMonth, 1, 31);
  const fullMonths = isFullRange(cron.months, 1, 12);
  const fullWeekdays = cron.daysOfWeek.length === 7;
  const times = cron.hours
    .map((hour) => formatTime(hour, cron.minutes[0] ?? 0))
    .join(", ");

  if (fullHours && fullDays && fullMonths && fullWeekdays) {
    if (cron.minuteStep) return `Every ${cron.minuteStep} minutes`;
    if (cron.minutes.length === 1) {
      return `Hourly at :${String(cron.minutes[0]).padStart(2, "0")}`;
    }
    return undefined;
  }
  if (cron.minutes.length !== 1) return undefined;
  if (fullDays && fullMonths && fullWeekdays) return `Daily at ${times}`;
  if (fullDays && fullMonths) {
    const named = cron.daysOfWeek
      .map((day) => CRON_DAY_NAMES[day])
      .filter((day) => Boolean(day));
    if (named.length === 0) return undefined;
    return `${named.map((day) => `${day}s`).join(", ")} at ${times}`;
  }
  if (fullMonths && fullWeekdays && cron.daysOfMonth.length === 1) {
    return `Monthly on day ${cron.daysOfMonth[0]} at ${times}`;
  }
  if (cron.daysOfMonth.length === 1 && cron.months.length === 1) {
    return `On ${CRON_MONTH_NAMES[cron.months[0]]} ${cron.daysOfMonth[0]} at ${times}`;
  }
  return undefined;
}

/**
 * Sort rank for a scheduled task: `[activeRank, frequencyRank, timeRank]`.
 * Active tasks sort before inactive; within the same active state, more
 * frequent cadences (daily < weekly < monthly) sort first; within the same
 * cadence, earlier wall-clock times sort first. Frequency bands mirror
 * `humanizeSchedule` and `humanizeCron` exactly — no new rrule or cron
 * parsing semantics are introduced here.
 */
export function scheduledTaskSortKey(
  task: ScheduledTask,
): [number, number, number] {
  const activeRank = task.status === "active" ? 0 : 1;

  let frequencyRank = 3;
  let timeRank = 0;
  if (task.scheduleRaw && !task.scheduleMissing) {
    const pairs = parsePairs(task.scheduleRaw);
    const freq = pairs.get("FREQ")?.at(0)?.toUpperCase();
    if (freq === "DAILY") frequencyRank = 0;
    else if (freq === "WEEKLY") frequencyRank = 1;
    else if (freq === "MONTHLY") frequencyRank = 2;
    const hour = Number.parseInt(pairs.get("BYHOUR")?.at(0) ?? "0", 10);
    const minute = Number.parseInt(pairs.get("BYMINUTE")?.at(0) ?? "0", 10);
    if (!Number.isNaN(hour) && !Number.isNaN(minute)) {
      timeRank = hour * 60 + minute;
    }
    // Zcode v2 stores cron, not rrule: when rrule parsing produced nothing,
    // derive the same bands from the cron fields so those tasks interleave
    // correctly instead of sinking to the end of the list.
    if (pairs.size === 0) {
      const cron = parseCron(task.scheduleRaw);
      if (cron) {
        const fullHours = isFullRange(cron.hours, 0, 23);
        const fullDays = isFullRange(cron.daysOfMonth, 1, 31);
        const fullMonths = isFullRange(cron.months, 1, 12);
        const fullWeekdays = cron.daysOfWeek.length === 7;
        const clockRank =
          fullHours || cron.minuteStep
            ? 0
            : (cron.hours[0] ?? 0) * 60 + cron.minutes[0];
        if (fullDays && fullMonths && fullWeekdays) {
          // Interval, hourly, and daily cadences.
          frequencyRank = 0;
        } else if (fullDays && fullMonths) {
          // Weekday-restricted cadences.
          frequencyRank = 1;
        } else {
          // Day-of-month and pinned-date shapes.
          frequencyRank = 2;
        }
        timeRank = clockRank;
      }
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
