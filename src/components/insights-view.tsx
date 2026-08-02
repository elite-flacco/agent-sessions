"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { formatCostUsd, runtime } from "@/lib/format";
import { DASHBOARD_REFRESH_INTERVAL_MS } from "@/lib/polling";
import type { Insights, InsightSignal, OverviewRange } from "@/lib/queries";
import { CapabilityUsageCard } from "./capability-usage-card";

interface InsightsViewProps {
  range: OverviewRange;
  insights: Insights;
}

function level(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.max(1, Math.round((value / max) * 10));
}

export function InsightsView({ range, insights }: InsightsViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rangePeriodLabel = range === "7d" ? "this week" : "the last 30 days";

  useEffect(() => {
    const timer = window.setInterval(
      () => router.refresh(),
      DASHBOARD_REFRESH_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [router]);

  function selectRange(next: OverviewRange) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "7d") params.delete("range");
    else params.set("range", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }

  return (
    <section className="relay-content">
      <header className="page-header">
        <div>
          <h1>Insights</h1>
          <p>Cost, cache, and capability usage for {rangePeriodLabel}.</p>
        </div>
        <div className="overview-range" aria-label="Insights range">
          <button
            className={`btn ${range === "7d" ? "btn-accent" : "btn-outline"}`}
            type="button"
            aria-pressed={range === "7d"}
            onClick={() => selectRange("7d")}
          >
            7 days
          </button>
          <button
            className={`btn ${range === "30d" ? "btn-accent" : "btn-outline"}`}
            type="button"
            aria-pressed={range === "30d"}
            onClick={() => selectRange("30d")}
          >
            30 days
          </button>
        </div>
      </header>

      <HeroStrip range={range} insights={insights} />

      <div className="insights-grid">
        <CacheCard range={range} insights={insights} />
        <CostCard range={range} insights={insights} />
        <div id="insight-capability" className="insight-capability-wrap">
          <CapabilityUsageCard capabilities={insights.capabilities} />
        </div>
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

function heroSignals(insights: Insights): InsightSignal[] {
  return [insights.cache.signal, insights.cost.signal]
    .filter((s): s is InsightSignal => s !== null)
    .sort(
      (a, b) => (a.tone === "warning" ? 0 : 1) - (b.tone === "warning" ? 0 : 1),
    );
}

export function SignalBand({ insights }: { insights: Insights }) {
  const signals = heroSignals(insights);

  if (signals.length === 0) return null;

  return (
    <div className="insight-signal-band">
      {signals.map((signal, i) => (
        <Signal key={`${signal.tone}-${i}`} signal={signal} />
      ))}
    </div>
  );
}

export function InsightSparkline({
  values,
  label,
}: {
  values: (number | null)[];
  label: string;
}) {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  const max = Math.max(...present, 0);

  return (
    <span className="spark insight-spark" role="img" aria-label={label}>
      {values.map((v, i) => (
        <span className="spark-slot" key={i}>
          <i className={`spark-fill-${level(v ?? 0, max)}`} />
        </span>
      ))}
    </span>
  );
}

function KpiTile({
  href,
  label,
  value,
  detail,
}: {
  href: string;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <a className="insight-kpi" href={href}>
      <span className="insight-kpi-label">{label}</span>
      <span className="insight-kpi-value">{value}</span>
      <span className="insight-kpi-detail">{detail}</span>
    </a>
  );
}

export function HeroStrip({
  range,
  insights,
}: {
  range: OverviewRange;
  insights: Insights;
}) {
  const { cache, cost, capabilities } = insights;

  const costValue =
    cost.week.totalUsd === null ? "—" : formatCostUsd(cost.week.totalUsd);
  const hitValue =
    cache.week.hitRate === null
      ? "—"
      : `${Math.round(cache.week.hitRate * 100)}%`;

  const adoptionValue =
    capabilities.installedCount > 0
      ? `${capabilities.installedUsedCount} / ${capabilities.installedCount}`
      : `${capabilities.used.length} used`;
  const capabilityRange = capabilities.range === "7d" ? "7 days" : "30 days";
  const rangeDaysLabel = range === "7d" ? "7 days" : "30 days";
  const adoptionDetail =
    capabilities.installedCount > 0
      ? `${capabilities.installedUsedCount} of ${capabilities.installedCount} installed capabilities used in ${capabilityRange}; complete providers only`
      : `${capabilities.used.length} capabilities used in ${capabilityRange}; no complete inventory denominator`;

  return (
    <div className="insight-hero">
      <KpiTile
        href="#insight-cost"
        label="Cost"
        value={costValue}
        detail={
          cost.week.totalUsd === null
            ? "Unavailable when any usage is unpriced"
            : `Priced total · last ${rangeDaysLabel}`
        }
      />
      <KpiTile
        href="#insight-cache"
        label="Cache hit rate"
        value={hitValue}
        detail={`Share of input served from cache · last ${rangeDaysLabel}`}
      />
      <KpiTile
        href="#insight-capability"
        label="Capability adoption"
        value={adoptionValue}
        detail={adoptionDetail}
      />
    </div>
  );
}

function CacheCard({
  range,
  insights,
}: {
  range: OverviewRange;
  insights: Insights;
}) {
  const { cache } = insights;
  const rangeDaysLabel = range === "7d" ? "7 days" : "30 days";
  const rangePeriodLabel = range === "7d" ? "this week" : "the last 30 days";
  const hitPct =
    cache.week.hitRate === null
      ? "—"
      : `${Math.round(cache.week.hitRate * 100)}%`;

  return (
    <section
      className="card insight-card"
      id="insight-cache"
      aria-label="Cache effectiveness"
    >
      <div className="insight-card-head">
        <h3>Cache effectiveness</h3>
        <span className="mono">last {rangeDaysLabel}</span>
      </div>

      <div>
        <div className="insight-headline">{hitPct}</div>
        <div className="insight-sub">overall cache hit rate</div>
      </div>

      <div className="insight-savings">
        {cache.week.savedUsd === null ? (
          <span>Avoided-spend estimate unavailable</span>
        ) : (
          <>
            <strong>{formatCostUsd(cache.week.savedUsd)}</strong>
            <span>estimated spend avoided by cached input</span>
          </>
        )}
        <span className="insight-sub">
          {cache.week.savedSharePct === null
            ? "Requires complete model pricing"
            : `${Math.round(cache.week.savedSharePct)}% of estimated model cost without cached reads`}
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
        <p className="overview-empty">
          No usage recorded yet {rangePeriodLabel}.
        </p>
      )}
    </section>
  );
}

function CostCard({
  range,
  insights,
}: {
  range: OverviewRange;
  insights: Insights;
}) {
  const { cost } = insights;
  const rangeDaysLabel = range === "7d" ? "7 days" : "30 days";
  const rangePeriodLabel = range === "7d" ? "this week" : "the last 30 days";
  const maxOutlier = Math.max(...cost.outliers.map((o) => o.costUsd), 0);

  return (
    <section
      className="card insight-card"
      id="insight-cost"
      aria-label="Cost outliers"
    >
      <div className="insight-card-head">
        <h3>Cost outliers</h3>
        <span className="mono">last {rangeDaysLabel}</span>
      </div>

      <div>
        <div className="insight-headline">
          {cost.week.paretoSharePct === null
            ? "—"
            : `3 sessions = ${Math.round(cost.week.paretoSharePct)}% of cost`}
        </div>
        <div className="insight-sub">
          {cost.week.totalUsd === null
            ? "Cost unavailable (some usage unpriced)"
            : `${formatCostUsd(cost.week.totalUsd)} total ${rangePeriodLabel}`}
        </div>
      </div>

      {cost.outliers.length ? (
        <div>
          <div className="insight-sub">
            Most expensive sessions (incl. subagents)
          </div>
          {cost.outliers.map((o) => (
            <CostOutlierRow
              key={o.id}
              outlier={o}
              periodTotalUsd={cost.week.totalUsd}
              maxOutlier={maxOutlier}
            />
          ))}
        </div>
      ) : (
        <p className="overview-empty">No priced sessions {rangePeriodLabel}.</p>
      )}
    </section>
  );
}

function CostOutlierRow({
  outlier,
  periodTotalUsd,
  maxOutlier,
}: {
  outlier: Insights["cost"]["outliers"][number];
  periodTotalUsd: number | null;
  maxOutlier: number;
}) {
  const shareOfPeriodPct =
    typeof outlier.shareOfPeriodPct === "number" &&
    Number.isFinite(outlier.shareOfPeriodPct)
      ? outlier.shareOfPeriodPct
      : Number.isFinite(periodTotalUsd) &&
          periodTotalUsd !== null &&
          periodTotalUsd > 0 &&
          Number.isFinite(outlier.costUsd)
        ? (outlier.costUsd / periodTotalUsd) * 100
        : null;
  const shareLabel =
    typeof shareOfPeriodPct === "number" && Number.isFinite(shareOfPeriodPct)
      ? `${Math.round(shareOfPeriodPct)}%`
      : "—";

  return (
    <Link
      href={`/sessions/${outlier.id}`}
      className="dist-row dist-row-wide cost-outlier-row"
      title={`${runtime(outlier.runtimeMs)} · $${outlier.usdPerMin.toFixed(2)}/min`}
    >
      <span className="dist-label">
        {outlier.title}
        {outlier.model ? (
          <span className="insight-sub"> · {outlier.model}</span>
        ) : null}
      </span>
      <span className="meter" aria-hidden>
        <i className={`meter-fill-${level(outlier.costUsd, maxOutlier)}`} />
      </span>
      <span className="mono cost-outlier-share">{shareLabel}</span>
      <span className="mono cost-outlier-cost">
        {formatCostUsd(outlier.costUsd)}
      </span>
    </Link>
  );
}
