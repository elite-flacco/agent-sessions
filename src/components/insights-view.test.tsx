// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Insights } from "@/lib/queries";
import { HeroStrip, InsightSparkline, SignalBand } from "./insights-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(cleanup);

function baseInsights(overrides: Partial<Insights> = {}): Insights {
  return {
    capabilities: {
      range: "7d",
      used: [],
      unused: [],
      installedCount: 0,
      installedUsedCount: 0,
      coverage: [],
    },
    cache: {
      week: {
        hitRate: null,
        hitRateDeltaPts: null,
        savedUsd: null,
        savedSharePct: null,
        byModel: [],
      },
      trend: [],
      signal: null,
    },
    cost: {
      week: { totalUsd: null, top5SharePct: null, paretoSharePct: null },
      outliers: [],
      trend: [],
      signal: null,
    },
    ...overrides,
  } as Insights;
}

describe("SignalBand", () => {
  test("orders warnings before info and renders both", () => {
    const insights = baseInsights();
    insights.cache.signal = { tone: "info", text: "cache info" };
    insights.cost.signal = { tone: "warning", text: "cost warning" };
    const { container } = render(<SignalBand insights={insights} />);
    const texts = [...container.querySelectorAll(".insight-signal span")].map(
      (n) => n.textContent,
    );
    expect(texts).toEqual(["cost warning", "cache info"]);
  });

  test("renders nothing when there are no signals", () => {
    const { container } = render(<SignalBand insights={baseInsights()} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("InsightSparkline", () => {
  test("renders one slot per value with quantized fills", () => {
    const { container } = render(
      <InsightSparkline values={[0, 5, 10]} label="trend" />,
    );
    const slots = container.querySelectorAll(".spark-slot");
    expect(slots).toHaveLength(3);
    expect(container.querySelector(".spark-fill-10")).not.toBeNull();
  });

  test("renders nothing when every value is null or empty", () => {
    const { container: a } = render(
      <InsightSparkline values={[]} label="trend" />,
    );
    expect(a.firstChild).toBeNull();
    const { container: b } = render(
      <InsightSparkline values={[null, null]} label="trend" />,
    );
    expect(b.firstChild).toBeNull();
  });
});

describe("HeroStrip", () => {
  test("renders cost, cache, and adoption tiles with values and anchors", () => {
    const insights = baseInsights();
    insights.cost.week.totalUsd = 48.2;
    insights.cost.trend = [
      { day: "2026-07-20", costUsd: 4 },
      { day: "2026-07-21", costUsd: 8 },
    ];
    insights.cache.week.hitRate = 0.54;
    insights.cache.trend = [
      { day: "2026-07-20", hitRate: 0.6 },
      { day: "2026-07-21", hitRate: 0.54 },
    ];
    insights.capabilities.installedCount = 14;
    insights.capabilities.installedUsedCount = 9;

    const { container } = render(<HeroStrip insights={insights} />);
    expect(screen.getByText("54%")).toBeInTheDocument();
    expect(screen.getByText("9 / 14")).toBeInTheDocument();
    expect(container.querySelector('a[href="#insight-cost"]')).not.toBeNull();
    expect(
      container.querySelector('a[href="#insight-capability"]'),
    ).not.toBeNull();
  });

  test("shows a bare used count when nothing qualifies for the ratio", () => {
    const insights = baseInsights();
    insights.capabilities.installedCount = 0;
    insights.capabilities.installedUsedCount = 0;
    insights.capabilities.used = [
      {
        kind: "skill",
        name: "x",
        invocations: 1,
        sessionCount: 1,
        lastUsedAt: "2026-07-21",
        providers: [],
        byProvider: {},
      },
    ];
    render(<HeroStrip insights={insights} />);
    expect(screen.getByText("1 used")).toBeInTheDocument();
  });

  test("renders em dash for null cost and cache headlines", () => {
    render(<HeroStrip insights={baseInsights()} />);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });
});
