import type { SessionStatus } from "./types";

export function elapsed(start: string, end?: string | null): string {
  const milliseconds = Math.max(
    0,
    new Date(end ?? Date.now()).getTime() - new Date(start).getTime(),
  );
  const minutes = Math.floor(milliseconds / 60_000);
  return minutes < 60
    ? `${minutes}m`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

// Statuses whose start→end span is not meaningful work time: failures inflate
// it with idle throttling, and interrupted/incomplete sessions never ran to a
// real end. Only completed/running (and awaiting-input) durations are shown.
const DURATIONLESS_STATUSES = new Set<SessionStatus>([
  "failed",
  "interrupted",
  "incomplete",
]);

export function hasMeaningfulDuration(status: SessionStatus): boolean {
  return !DURATIONLESS_STATUSES.has(status);
}

export function relativeTime(value: string): string {
  const date = new Date(value);
  const now = new Date();
  const diffMinutes = Math.round((now.getTime() - date.getTime()) / 60_000);
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  if (date.toDateString() === now.toDateString()) return time;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function absoluteTime(value: string): string {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function isOlderThan(value: string, milliseconds: number): boolean {
  return Date.now() - new Date(value).getTime() > milliseconds;
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000_000)
    return `${(value / 1_000_000_000).toFixed(1)}B tok`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M tok`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k tok`;
  return `${value} tok`;
}

export function formatCostUsd(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

export function runtime(value: number): string {
  const minutes = Math.round(value / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

// Quantize a value to a 0–10 fill step. `Meter`/`Sparkline` turn the result
// into an inline percent (width/height); the heatmap turns it into a
// `heat-fill-N` class. Any positive value lands on at least step 1 so a
// non-zero row never renders as empty.
export function level(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.max(1, Math.round((value / max) * 10));
}

/**
 * Shorten an absolute path for compact display by replacing the user's home
 * directory with `~` and trimming intermediate cache-version segments of the
 * form `~/.<provider>/plugins/cache/<marketplace>/<plugin>/<version>/...`
 * down to `~/.<provider>/plugins/cache/<marketplace>/<plugin>/...`. Used to
 * surface distinguishing install paths for duplicate skills in the inventory
 * view; falls back to the input (with home substitution) when the path
 * doesn't match the plugin-cache shape.
 */
export function shortenHomePath(input: string): string {
  const home = process.env.HOME ?? "";
  let value = input;
  if (home && (value === home || value.startsWith(`${home}/`))) {
    value = `~${value.slice(home.length)}`;
  }
  // Collapse plugin-cache version dirs:
  // ~/.<provider>/plugins/cache/<marketplace>/<plugin>/<hex-or-semver>/
  // -> ~/.<provider>/plugins/cache/<marketplace>/<plugin>/
  value = value.replace(
    /^(~\/\.[^/]+\/plugins\/cache\/[^/]+\/[^/]+)\/[^/]+\/skills\//,
    "$1/skills/",
  );
  return value;
}
