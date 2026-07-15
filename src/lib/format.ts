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
  const now = new Date();
  const diffMinutes = Math.round((now.getTime() - date.getTime()) / 60_000);
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  if (date.toDateString() === now.toDateString()) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString())
    return `Yesterday ${time}`;
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
