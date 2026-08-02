// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Insights } from "@/lib/queries";
import {
  HeroStrip,
  InsightsView,
  InsightSparkline,
  SignalBand,
} from "./insights-view";

const replace = vi.fn();
let query = "";

vi.mock("next/navigation", () => ({
  usePathname: () => "/insights",
  useRouter: () => ({ refresh: vi.fn(), replace }),
  useSearchParams: () => new URLSearchParams(query),
}));

// The InsightsView wrapper-hook test isolates grid structure; it doesn't need
// CapabilityUsageCard's real nav/param behavior. Stubbing it keeps the test a
// true unit of the insights-view grid wiring (and lets the assertion run).
vi.mock("./capability-usage-card", () => ({
  CapabilityUsageCard: () => null,
}));

afterEach(() => {
  cleanup();
  replace.mockReset();
  query = "";
});

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

    const { container } = render(<HeroStrip range="7d" insights={insights} />);
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
    render(<HeroStrip range="7d" insights={insights} />);
    expect(screen.getByText("1 used")).toBeInTheDocument();
  });

  test("renders em dash for null cost and cache headlines", () => {
    render(<HeroStrip range="7d" insights={baseInsights()} />);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });
});

describe("InsightsView", () => {
  test("does not add a page-level recommendation when metric signals exist", () => {
    const insights = baseInsights();
    insights.cache.signal = {
      tone: "warning",
      text: "Cache hit rate dropped 12 points week-over-week.",
    };
    insights.cost.signal = {
      tone: "warning",
      text: "Three sessions drove 74% of this week's cost.",
    };

    render(<InsightsView range="7d" insights={insights} />);

    expect(
      screen.queryByRole("region", { name: "Top insight" }),
    ).not.toBeInTheDocument();
  });

  test("explains estimated cache savings as avoided spend rather than a charge", () => {
    const insights = baseInsights();
    insights.cache.week.savedUsd = 120.4;
    insights.cache.week.savedSharePct = 64;

    render(<InsightsView range="7d" insights={insights} />);

    const cacheCard = screen.getByRole("region", {
      name: "Cache effectiveness",
    });
    expect(cacheCard).toHaveTextContent("$120.40");
    expect(cacheCard).toHaveTextContent(
      "estimated spend avoided by cached input",
    );
    expect(cacheCard.querySelector("strong")).toHaveTextContent("$120.40");
    expect(cacheCard.querySelector("strong")).not.toHaveTextContent(
      "estimated spend avoided by cached input",
    );
    expect(cacheCard).toHaveTextContent("not an amount charged");
    expect(cacheCard).toHaveTextContent(
      "64% of estimated model cost without cached reads",
    );
  });

  test("does not show a cache week-over-week delta", () => {
    const insights = baseInsights();
    insights.cache.week.hitRateDeltaPts = -2;

    render(<InsightsView range="7d" insights={insights} />);

    expect(screen.queryByText(/wk-over-wk/i)).not.toBeInTheDocument();
    expect(document.querySelector(".insight-delta")).toBeNull();
  });

  test("labels capability adoption as usage in the selected range", () => {
    const insights = baseInsights();
    insights.capabilities.range = "30d";
    insights.capabilities.installedCount = 14;
    insights.capabilities.installedUsedCount = 9;

    render(<InsightsView range="7d" insights={insights} />);

    expect(screen.getByText("Capability adoption")).toBeVisible();
    expect(
      screen.getByText(
        /9 of 14 installed capabilities used in 30 days; complete providers only/i,
      ),
    ).toBeVisible();
  });

  test("the capability wrapper div carries the full-width grid hook", () => {
    const { container } = render(
      <InsightsView range="7d" insights={baseInsights()} />,
    );
    // The grid's direct child for capability must carry the span class so
    // grid-column: 1 / -1 targets the grid item, not the inner section.
    const wrap = container.querySelector("#insight-capability");
    expect(wrap).not.toBeNull();
    expect(wrap?.classList.contains("insight-capability-wrap")).toBe(true);
  });

  test("cost card headline shows the top-3 Pareto share when priced", () => {
    const insights = baseInsights();
    insights.cost.week.totalUsd = 100;
    insights.cost.week.paretoSharePct = 81;
    render(<InsightsView range="7d" insights={insights} />);
    expect(screen.getByText("3 sessions = 81% of cost")).toBeInTheDocument();
  });

  test("shows each outlier's share of the selected period total", () => {
    const insights = baseInsights();
    insights.cost.week.totalUsd = 100;
    insights.cost.outliers = [
      {
        id: 1,
        title: "Expensive session",
        model: null,
        costUsd: 42,
        shareOfPeriodPct: Number.NaN,
        runtimeMs: 60_000,
        usdPerMin: 42,
      },
    ];

    render(<InsightsView range="7d" insights={insights} />);

    const costCard = screen.getByRole("region", { name: "Cost outliers" });
    expect(costCard).toHaveTextContent("Share");
    expect(costCard).toHaveTextContent("42%");
  });

  test("never renders a non-finite outlier share", () => {
    const insights = baseInsights();
    insights.cost.outliers = [
      {
        id: 1,
        title: "Unavailable share",
        model: null,
        costUsd: 42,
        shareOfPeriodPct: Number.NaN,
        runtimeMs: 60_000,
        usdPerMin: 42,
      },
    ];

    render(<InsightsView range="7d" insights={insights} />);

    expect(screen.queryByText("NaN%")).not.toBeInTheDocument();
    expect(document.querySelector(".cost-outlier-share")).toHaveTextContent(
      "—",
    );
  });

  test("cost card headline is an em dash when the week is unpriced", () => {
    render(<InsightsView range="7d" insights={baseInsights()} />);
    // baseInsights has paretoSharePct: null — headline must fall back, not
    // render a misleading "3 sessions = NaN%" or "0%".
    const costCard = document.getElementById("insight-cost");
    expect(costCard?.querySelector(".insight-headline")).toHaveTextContent("—");
  });

  test("writes the shared 30-day range without discarding capability tab state", () => {
    query = "capabilityTab=unused";
    render(<InsightsView range="7d" insights={baseInsights()} />);

    fireEvent.click(screen.getByRole("button", { name: "30 days" }));

    expect(replace).toHaveBeenCalledWith(
      "/insights?capabilityTab=unused&range=30d",
      { scroll: false },
    );
  });

  test("uses the shared range in all card labels", () => {
    render(<InsightsView range="30d" insights={baseInsights()} />);

    expect(screen.getByLabelText("Insights range")).toBeVisible();
    expect(screen.getAllByText("last 30 days").length).toBeGreaterThanOrEqual(
      2,
    );
    expect(
      screen.getByText(
        /Cost, cache, and capability usage for the last 30 days/,
      ),
    ).toBeVisible();
  });
});
