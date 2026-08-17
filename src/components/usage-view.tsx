"use client";

import { BarChart3, FolderKanban } from "lucide-react";
import Link from "next/link";
import { formatCostUsd, formatTokens, pluralize } from "@/lib/format";
import type { OverviewRange, UsageBucket, UsageSummary } from "@/lib/queries";
import type { AgentProvider } from "@/lib/types";
import { Meter, Sparkline } from "./charts";
import { Metric } from "./metric";
import { ProviderBadge } from "./provider-badge";
import { RangeSwitcher } from "./range-switcher";
import { useDashboardPolling } from "./use-dashboard-polling";

interface UsageViewProps {
  usage: UsageSummary;
  range: OverviewRange;
}

export function UsageView({ usage, range }: UsageViewProps) {
  useDashboardPolling();

  const maxProvider = Math.max(
    ...usage.byProvider.map((bucket) => bucket.costUsd),
    0,
  );

  return (
    <section className="agentarium-content">
      <header className="page-header">
        <div>
          <h1>Usage &amp; cost</h1>
          <p>API-equivalent estimates from public token pricing</p>
        </div>
        <RangeSwitcher range={range} ariaLabel="Usage range" />
      </header>

      <div className="summary-grid" aria-label="Selected usage summary">
        <Metric
          label="Estimated cost"
          value={formatCostUsd(usage.selected.costUsd)}
          note={
            usage.selected.unpricedSessions
              ? `${usage.selected.unpricedSessions} ${pluralize(usage.selected.unpricedSessions, "session")} without pricing`
              : "API-equivalent estimate"
          }
        />
        <Metric
          label="Tokens"
          value={formatTokens(usage.selected.tokens)}
          note={`${usage.selected.sessions} sessions with usage`}
        />
        <Metric
          label="Sessions"
          value={String(usage.selected.sessions)}
          note="Sessions with recorded token usage"
        />
        <Metric
          label="Cache reads"
          value={formatTokens(usage.selected.cacheReadTokens)}
          note={
            usage.selected.tokens
              ? `${Math.round((usage.selected.cacheReadTokens / usage.selected.tokens) * 100)}% of all tokens`
              : "No usage recorded"
          }
        />
      </div>

      <div className="overview-grid">
        <div className="overview-column">
          <section className="card overview-card" aria-label="Daily cost">
            <div className="overview-card-head">
              <h3>{`Daily cost`}</h3>
              <span>{formatCostUsd(usage.selected.costUsd)} total</span>
            </div>
            <Sparkline
              className={range === "all" ? "usage-spark-all" : undefined}
              values={usage.daily.map((day) => day.costUsd)}
              label="Estimated cost per day"
              slotTitle={(index) => {
                const day = usage.daily[index];
                return `${day.date}: ${formatCostUsd(day.costUsd)} · ${formatTokens(day.tokens)}`;
              }}
            />
          </section>

          <section className="card overview-card" aria-label="Cost by model">
            <div className="overview-card-head">
              <h3>By model</h3>
            </div>
            {usage.byModel.length ? (
              usage.byModel.map((bucket) => (
                <BucketRow
                  key={bucket.key}
                  bucket={bucket}
                  max={maxModel(usage)}
                  mono
                />
              ))
            ) : (
              <p className="overview-empty">No usage recorded yet.</p>
            )}
          </section>
        </div>

        <div className="overview-column">
          <section className="card overview-card" aria-label="Cost by agent">
            <div className="overview-card-head">
              <h3>
                <BarChart3 size={14} className="inline-icon" /> By agent
              </h3>
            </div>
            {usage.byProvider.length ? (
              usage.byProvider.map((bucket) => (
                <Link
                  key={bucket.key}
                  className="dist-row dist-row-wide"
                  href={`/sessions?provider=${bucket.key}${range === "7d" ? "" : `&range=${range}`}`}
                >
                  <ProviderBadge provider={bucket.key as AgentProvider} />
                  <Meter value={bucket.costUsd} max={maxProvider} />
                  <span className="mono">{formatCostUsd(bucket.costUsd)}</span>
                </Link>
              ))
            ) : (
              <p className="overview-empty">No usage recorded yet.</p>
            )}
          </section>

          <section className="card overview-card" aria-label="Cost by project">
            <div className="overview-card-head">
              <h3>
                <FolderKanban size={14} className="inline-icon" /> By project
              </h3>
              <Link
                href={`/sessions?view=projects${range === "7d" ? "" : `&range=${range}`}`}
              >
                View projects
              </Link>
            </div>
            {usage.byProject.length ? (
              usage.byProject
                .slice(0, 8)
                .map((bucket) => (
                  <BucketRow
                    key={bucket.key}
                    bucket={bucket}
                    max={usage.byProject[0]?.costUsd ?? 0}
                    label={
                      bucket.key === "(unknown)"
                        ? "Unknown workspace"
                        : bucket.key
                    }
                  />
                ))
            ) : (
              <p className="overview-empty">No usage recorded yet.</p>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}

function maxModel(usage: UsageSummary): number {
  return Math.max(...usage.byModel.map((bucket) => bucket.costUsd), 0);
}

function BucketRow({
  bucket,
  max,
  label,
  mono,
}: {
  bucket: UsageBucket;
  max: number;
  label?: string;
  mono?: boolean;
}) {
  return (
    <div
      className="dist-row dist-row-wide"
      title={`${formatTokens(bucket.tokens)} across ${bucket.sessions} sessions`}
    >
      <span className={mono ? "mono dist-label" : "dist-label"}>
        {label ?? bucket.key}
      </span>
      <Meter value={bucket.costUsd} max={max} />
      <span className="mono">{formatCostUsd(bucket.costUsd)}</span>
    </div>
  );
}
