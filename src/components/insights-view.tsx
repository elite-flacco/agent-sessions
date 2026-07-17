"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { formatCostUsd, runtime } from "@/lib/format";
import { PRICING_RETRIEVED_AT } from "@/lib/pricing";
import type { Insights, InsightSignal } from "@/lib/queries";

interface InsightsViewProps {
  insights: Insights;
}

function level(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.max(1, Math.round((value / max) * 10));
}

export function InsightsView({ insights }: InsightsViewProps) {
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [router]);

  return (
    <section className="relay-content">
      <header className="page-header">
        <div>
          <h1>Insights</h1>
          <p>
            Actionable efficiency signals from your coding-agent usage.
            API-equivalent cost estimates from public per-token rates (pricing
            recorded {PRICING_RETRIEVED_AT}); cache hit rate is token-only and
            always available.
          </p>
        </div>
      </header>

      <div className="insights-grid">
        <CacheCard insights={insights} />
        <CostCard insights={insights} />
      </div>
    </section>
  );
}

function Signal({ signal }: { signal: InsightSignal }) {
  return (
    <div
      className={`insight-signal is-${signal.tone}`}
      role={signal.tone === "warning" ? "alert" : "status"}
    >
      <Sparkles size={13} />
      <span>{signal.text}</span>
    </div>
  );
}

function CacheCard({ insights }: { insights: Insights }) {
  const { cache } = insights;
  const hitPct =
    cache.week.hitRate === null
      ? "—"
      : `${Math.round(cache.week.hitRate * 100)}%`;
  const deltaPts = cache.week.hitRateDeltaPts;
  const deltaClass =
    deltaPts === null
      ? ""
      : deltaPts > 0
        ? "is-up"
        : deltaPts < 0
          ? "is-down"
          : "";
  const deltaLabel =
    deltaPts === null
      ? ""
      : `${deltaPts > 0 ? "▲" : "▼"} ${Math.abs(Math.round(deltaPts))} pts wk-over-wk`;
  const maxTrend = Math.max(...cache.trend.map((d) => d.hitRate ?? 0), 0);

  return (
    <section className="card insight-card" aria-label="Cache effectiveness">
      <div className="insight-card-head">
        <h3>Cache effectiveness</h3>
        <span className="mono">last 7 days</span>
      </div>

      {cache.signal && <Signal signal={cache.signal} />}

      <div>
        <div className="insight-headline">{hitPct}</div>
        <div className="insight-sub">weighted cache hit rate</div>
        {deltaLabel && (
          <div className={`insight-delta ${deltaClass}`}>{deltaLabel}</div>
        )}
      </div>

      <div>
        <strong>
          {cache.week.savedUsd === null
            ? "Unavailable"
            : `${formatCostUsd(cache.week.savedUsd)} saved`}
        </strong>
        <span className="insight-sub">
          {cache.week.savedSharePct === null
            ? "Requires full pricing"
            : `${Math.round(cache.week.savedSharePct)}% of gross cost`}
        </span>
      </div>

      {cache.week.byModel.length ? (
        <div>
          <div className="insight-sub">Hit rate by model</div>
          {cache.week.byModel.map((m) => (
            <div className="dist-row dist-row-wide" key={m.model}>
              <span className="mono dist-label">{m.model}</span>
              <span className="meter" aria-hidden>
                <i className={`meter-fill-${level(m.hitRate, 1)}`} />
              </span>
              <span className="mono">{Math.round(m.hitRate * 100)}%</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="overview-empty">No usage recorded yet this week.</p>
      )}

      <div>
        <div className="insight-sub">Hit rate, last 30 days</div>
        <div
          className="spark"
          role="img"
          aria-label="Daily cache hit rate, last 30 days"
        >
          {cache.trend.map((d) => (
            <span
              key={d.day}
              className="spark-slot"
              title={`${d.day}: ${d.hitRate === null ? "no usage" : `${Math.round(d.hitRate * 100)}%`}`}
            >
              <i className={`spark-fill-${level(d.hitRate ?? 0, maxTrend)}`} />
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function CostCard({ insights }: { insights: Insights }) {
  const { cost } = insights;
  const maxOutlier = Math.max(...cost.outliers.map((o) => o.costUsd), 0);

  return (
    <section className="card insight-card" aria-label="Cost outliers">
      <div className="insight-card-head">
        <h3>Cost outliers</h3>
        <span className="mono">last 7 days</span>
      </div>

      {cost.signal && <Signal signal={cost.signal} />}

      <div>
        <div className="insight-headline">
          {cost.week.paretoSharePct === null
            ? "—"
            : `Top 5 = ${Math.round(cost.week.paretoSharePct)}%`}
        </div>
        <div className="insight-sub">
          {cost.week.totalUsd === null
            ? "Week cost unavailable (some usage unpriced)"
            : `${formatCostUsd(cost.week.totalUsd)} total this week`}
        </div>
      </div>

      {cost.outliers.length ? (
        <div>
          <div className="insight-sub">Most expensive sessions</div>
          {cost.outliers.map((o) => (
            <Link
              key={o.id}
              href={`/sessions/${o.id}`}
              className="dist-row dist-row-wide"
              title={`${runtime(o.runtimeMs)} · $${o.usdPerMin.toFixed(2)}/min`}
            >
              <span className="dist-label">{o.title}</span>
              <span className="meter" aria-hidden>
                <i className={`meter-fill-${level(o.costUsd, maxOutlier)}`} />
              </span>
              <span className="mono">{formatCostUsd(o.costUsd)}</span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="overview-empty">No priced sessions this week.</p>
      )}
    </section>
  );
}
