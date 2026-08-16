"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { formatCostUsd, runtime } from "@/lib/format";
import { rangeDaysLabel } from "@/lib/labels";
import { DASHBOARD_REFRESH_INTERVAL_MS } from "@/lib/polling";
import type { Insights, InsightSignal, OverviewRange } from "@/lib/queries";
import { CapabilityUsageCard } from "./capability-usage-card";
import { Meter, Sparkline } from "./charts";
import { RangeSwitcher } from "./range-switcher";

interface InsightsViewProps {
  range: OverviewRange;
  insights: Insights;
}

export function InsightsView({ range, insights }: InsightsViewProps) {
  const router = useRouter();
  const rangePeriodLabel =
    range === "7d"
      ? "this week"
      : range === "30d"
        ? "the last 30 days"
        : "all time";

  useEffect(() => {
    const timer = window.setInterval(
      () => router.refresh(),
      DASHBOARD_REFRESH_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [router]);

  return (
    <section className="relay-content">
      <header className="page-header">
        <div>
          <h1>Insights</h1>
          <p>Cost, cache, and capability usage for {rangePeriodLabel}.</p>
        </div>
        <RangeSwitcher range={range} ariaLabel="Insights range" />
      </header>

      <HeroStrip range={range} insights={insights} />

      <div className="insights-grid">
        <div id="insight-capability" className="insight-capability-wrap">
          <CapabilityUsageCard capabilities={insights.capabilities} />
        </div>
        <CacheCard range={range} insights={insights} />
        <CostCard range={range} insights={insights} />
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
      <span className="text-foreground">{signal.text}</span>
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
  return <Sparkline values={values} label={label} className="insight-spark" />;
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
    <a className="metric metric-link" href={href}>
      <span className="eyebrow">{label}</span>
      <strong>{value}</strong>
      <span>{detail}</span>
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
  const capabilityRange = rangeDaysLabel(capabilities.range);
  const daysLabel = rangeDaysLabel(range);
  const windowLabel = range === "all" ? "all time" : `last ${daysLabel}`;
  const adoptionDetail =
    capabilities.installedCount > 0
      ? `${capabilities.installedUsedCount} of ${capabilities.installedCount} installed capabilities used ${capabilities.range === "all" ? "across" : "in"} ${capabilityRange}`
      : `${capabilities.used.length} capabilities used ${capabilities.range === "all" ? "across" : "in"} ${capabilityRange}; no complete inventory denominator`;

  return (
    <div className="summary-grid insight-hero">
      <KpiTile
        href="#insight-cost"
        label="Cost"
        value={costValue}
        detail={
          cost.week.totalUsd === null
            ? "Unavailable when any usage is unpriced"
            : `Priced total · ${windowLabel}`
        }
      />
      <KpiTile
        href="#insight-cache"
        label="Cache hit rate"
        value={hitValue}
        detail={`Share of input served from cache · ${windowLabel}`}
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
  const daysLabel = rangeDaysLabel(range);
  const windowLabel = range === "all" ? "all time" : `last ${daysLabel}`;
  const rangePeriodLabel =
    range === "7d"
      ? "this week"
      : range === "30d"
        ? "the last 30 days"
        : "across all time";
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
        <h3 className="text-sm">Cache effectiveness</h3>
        <span className="mono">{windowLabel}</span>
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
          {cache.week.byModel.map((m) => (
            <div className="dist-row dist-row-wide" key={m.model}>
              <span className="dist-label">{m.model}</span>
              <Meter value={m.hitRate} max={1} />
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
  const daysLabel = rangeDaysLabel(range);
  const windowLabel = range === "all" ? "all time" : `last ${daysLabel}`;
  const rangePeriodLabel =
    range === "7d"
      ? "this week"
      : range === "30d"
        ? "the last 30 days"
        : "across all time";
  const maxOutlier = Math.max(...cost.outliers.map((o) => o.costUsd), 0);

  return (
    <section
      className="card insight-card"
      id="insight-cost"
      aria-label="Cost outliers"
    >
      <div className="insight-card-head">
        <h3 className="text-sm">Cost outliers</h3>
        <span className="mono">{windowLabel}</span>
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

// Prefer the query-provided share; otherwise derive it from the period total
// when that is known and positive; otherwise there is nothing to show.
function outlierShare(
  outlier: Insights["cost"]["outliers"][number],
  periodTotalUsd: number | null,
): number | null {
  if (
    typeof outlier.shareOfPeriodPct === "number" &&
    Number.isFinite(outlier.shareOfPeriodPct)
  ) {
    return outlier.shareOfPeriodPct;
  }
  if (
    periodTotalUsd !== null &&
    periodTotalUsd > 0 &&
    Number.isFinite(outlier.costUsd)
  ) {
    return (outlier.costUsd / periodTotalUsd) * 100;
  }
  return null;
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
  const share = outlierShare(outlier, periodTotalUsd);
  const shareLabel = share === null ? "—" : `${Math.round(share)}%`;

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
      <Meter value={outlier.costUsd} max={maxOutlier} />
      <span className="mono cost-outlier-cost">
        {formatCostUsd(outlier.costUsd)}
      </span>
      <span className="mono cost-outlier-share">{shareLabel}</span>
    </Link>
  );
}
