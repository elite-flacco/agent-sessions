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

export function relativeTime(value: string): string {
  const date = new Date(value);
  const diffMinutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffMinutes < 1440)
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function isOlderThan(value: string, milliseconds: number): boolean {
  return Date.now() - new Date(value).getTime() > milliseconds;
}

export function runtime(value: number): string {
  const minutes = Math.round(value / 60_000);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
