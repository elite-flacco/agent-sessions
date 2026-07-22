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
