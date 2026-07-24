// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Insights } from "@/lib/queries";
import { InsightSparkline, SignalBand } from "./insights-view";

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
      week: { hitRate: null, hitRateDeltaPts: null, savedUsd: null, savedSharePct: null, byModel: [] },
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
