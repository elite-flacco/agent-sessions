"use client";

import { BarChart3, FolderKanban } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { formatCostUsd, formatTokens } from "@/lib/format";
import { providerBadges, providerLabels } from "@/lib/labels";
import { DASHBOARD_REFRESH_INTERVAL_MS } from "@/lib/polling";
import type { UsageBucket, UsageSummary, UsageWindow } from "@/lib/queries";
import type { AgentProvider } from "@/lib/types";
import { Meter, Sparkline } from "./charts";

interface UsageViewProps {
  usage: UsageSummary;
}

export function UsageView({ usage }: UsageViewProps) {
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(
      () => router.refresh(),
      DASHBOARD_REFRESH_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [router]);

  const maxProvider = Math.max(
    ...usage.byProvider.map((bucket) => bucket.costUsd),
    0,
  );

  return (
    <section className="relay-content">
      <header className="page-header">
        <div>
          <h1>Usage &amp; cost</h1>
          <p>
            API-equivalent estimates from public per-token rates; subscription
            plans bill differently. Pi costs are provider-reported.
          </p>
        </div>
      </header>

      <div className="summary-grid" aria-label="Usage windows">
        <UsageMetric label="Today" window={usage.today} />
        <UsageMetric label="Last 7 days" window={usage.week} />
        <UsageMetric label="Last 30 days" window={usage.month} />
        <div className="metric">
          <span className="eyebrow">Cache reads, 30 days</span>
          <strong>{formatTokens(usage.month.cacheReadTokens)}</strong>
          <span>
            {usage.month.tokens
              ? `${Math.round((usage.month.cacheReadTokens / usage.month.tokens) * 100)}% of all tokens`
              : "No usage recorded"}
          </span>
        </div>
      </div>

      <div className="overview-grid">
        <div className="overview-column">
          <section className="card overview-card" aria-label="Daily cost">
            <div className="overview-card-head">
              <h3>Daily cost, last 30 days</h3>
              <span>{formatCostUsd(usage.month.costUsd)} total</span>
            </div>
            <Sparkline
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
                  href={`/sessions?provider=${bucket.key}`}
                >
                  <span
                    className={`badge ${providerBadges[bucket.key as AgentProvider]}`}
                  >
                    {providerLabels[bucket.key as AgentProvider]}
                  </span>
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
              <Link href="/sessions?view=projects">View projects</Link>
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

function UsageMetric({
  label,
  window,
}: {
  label: string;
  window: UsageWindow;
}) {
  return (
    <div className="metric">
      <span className="eyebrow">{label}</span>
      <strong>{formatCostUsd(window.costUsd)}</strong>
      <span>
        {formatTokens(window.tokens)} · {window.sessions} sessions
        {window.unpricedSessions
          ? ` · ${window.unpricedSessions} without pricing`
          : ""}
      </span>
    </div>
  );
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
