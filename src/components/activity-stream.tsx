"use client";

import {
  Activity,
  AlertTriangle,
  ArrowUpToLine,
  ChevronDown,
  CircleDot,
  Clock3,
  Database,
  Pause,
  Play,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { ActivityBlock } from "@/lib/activity";
import { isOlderThan, relativeTime } from "@/lib/format";
import { providerBadges, providerLabels, statusLabels } from "@/lib/labels";
import type { ActivityStreamFilters, CollectorHealth } from "@/lib/queries";
import { ActivityRow } from "./activity-row";

interface ActivityStreamProps {
  blocks: ActivityBlock[];
  totalEvents: number;
  repositories: string[];
  filters: ActivityStreamFilters;
  health: CollectorHealth;
}

const STALE_INGEST_MS = 15 * 60 * 1000;

export function ActivityStream({
  blocks,
  totalEvents,
  repositories,
  filters,
  health,
}: ActivityStreamProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [paused, setPaused] = useState(false);
  const [follow, setFollow] = useState(true);
  const [isPending, startTransition] = useTransition();
  const newestEventId = blocks[0]?.events[0]?.id;

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => router.refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [paused, router]);

  useEffect(() => {
    function onScroll(): void {
      if (window.scrollY > 240) setFollow(false);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (follow && newestEventId !== undefined) window.scrollTo({ top: 0 });
  }, [follow, newestEventId]);

  function updateParam(name: string, value: string): void {
    const params = new URLSearchParams(window.location.search);
    if (value === "all") params.delete(name);
    else params.set(name, value);
    startTransition(() =>
      router.replace(
        params.size ? `${pathname}?${params.toString()}` : pathname,
      ),
    );
  }

  const ingestDelayed =
    health.lastSyncedAt !== null &&
    isOlderThan(health.lastSyncedAt, STALE_INGEST_MS);

  return (
    <section className="relay-content">
      <header className="page-header">
        <div>
          <h1>Live activity</h1>
          <p>Streaming events from every agent session.</p>
        </div>
        <div className="stream-actions">
          <button
            className={follow ? "btn btn-primary" : "btn btn-outline"}
            onClick={() => {
              setFollow(!follow);
              if (!follow) window.scrollTo({ top: 0 });
            }}
            aria-pressed={follow}
          >
            <ArrowUpToLine size={14} />
            Follow newest
          </button>
          <button
            className="btn btn-outline"
            onClick={() => {
              const next = !paused;
              setPaused(next);
              if (!next) router.refresh();
            }}
            aria-pressed={paused}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
            {paused ? "Resume" : "Pause"}
          </button>
        </div>
      </header>

      <div className="health-strip" aria-label="Collector health">
        <span className="health-item">
          <Database size={13} />
          {health.sources} sources indexed
        </span>
        <span
          className={
            health.parseErrors ? "health-item health-warning" : "health-item"
          }
        >
          <AlertTriangle size={13} />
          {health.parseErrors} parse errors
        </span>
        <span
          className={
            health.recentSyncErrors
              ? "health-item health-warning"
              : "health-item"
          }
        >
          <Activity size={13} />
          {health.recentSyncErrors} sync errors in 24h
        </span>
        <span
          className={
            ingestDelayed ? "health-item health-warning" : "health-item"
          }
        >
          <Clock3 size={13} />
          {health.lastSyncedAt
            ? `Last ingest ${relativeTime(health.lastSyncedAt)}${ingestDelayed ? " — may be stale" : ""}`
            : "Nothing ingested yet"}
        </span>
        {health.delayedProviders.length > 0 && (
          <span className="health-item health-warning">
            <AlertTriangle size={13} />
            Scans delayed:{" "}
            {health.delayedProviders
              .map(
                (provider) =>
                  providerLabels[provider as keyof typeof providerLabels] ??
                  provider,
              )
              .join(", ")}
          </span>
        )}
        <span
          className={paused ? "health-item health-warning" : "health-item"}
          role="status"
        >
          <CircleDot size={13} />
          {paused ? "Stream paused" : "Auto-refreshing every 5s"}
        </span>
      </div>

      <div className="stream-filter-row">
        <label className="filter-select">
          <select
            className="select"
            aria-label="Filter by agent"
            value={filters.provider ?? "all"}
            onChange={(event) => updateParam("provider", event.target.value)}
          >
            <option value="all">All agents</option>
            {Object.entries(providerLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <ChevronDown size={13} />
        </label>
        <label className="filter-select">
          <select
            className="select"
            aria-label="Filter by repository"
            value={filters.repo ?? "all"}
            onChange={(event) => updateParam("repo", event.target.value)}
          >
            <option value="all">All repositories</option>
            {repositories.map((repository) => (
              <option key={repository} value={repository}>
                {repository}
              </option>
            ))}
            <option value="unknown">Unknown workspace</option>
          </select>
          <ChevronDown size={13} />
        </label>
        <span className="stream-count">
          {totalEvents} recent events
          {isPending ? " · Updating…" : ""}
        </span>
      </div>

      <div className={`stream-list ${isPending ? "workspace-loading" : ""}`}>
        {blocks.length ? (
          blocks.map((block) => (
            <article key={block.key} className="stream-block">
              <header className="stream-block-head">
                <span className={`badge ${providerBadges[block.provider]}`}>
                  {providerLabels[block.provider]}
                </span>
                <div className="stream-block-title">
                  <strong>{block.sessionTitle}</strong>
                  <span className="mono">
                    {block.repository ?? "Unknown workspace"}
                    {block.branch ? ` · ${block.branch}` : ""}
                  </span>
                </div>
                <span className={`status-label status-${block.sessionStatus}`}>
                  <i />
                  {statusLabels[block.sessionStatus]}
                </span>
              </header>
              <div className="stream-block-events">
                {block.events.map((event) => (
                  <ActivityRow key={event.id} event={event} />
                ))}
              </div>
            </article>
          ))
        ) : (
          <div className="empty-state">
            <Activity size={24} />
            <h3>No activity yet</h3>
            <p>
              Events appear here as agents work. Adjust the filters or run a
              sync from the Sessions page.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
