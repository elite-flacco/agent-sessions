import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { OverviewView } from "./overview-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("OverviewView", () => {
  test("does not render a heatmap intensity legend", () => {
    const html = renderToStaticMarkup(
      <OverviewView
        overview={{
          today: { sessions: 0, runtimeMs: 0, events: 0 },
          week: { sessions: 0, runtimeMs: 0, events: 0, failures: 0 },
          providerCounts: [],
          daily: [],
        }}
        patterns={{
          heatmap: Array.from({ length: 7 * 24 }, (_, index) => ({
            dayOfWeek: Math.floor(index / 24),
            hour: index % 24,
            count: 0,
          })),
          length: {
            buckets: [],
            medianMs: null,
            longestMs: null,
            longTailShare: null,
            sessionCount: 0,
          },
          costWeek: { costUsd: null, tokens: 0, topModels: [] },
        }}
        running={[]}
        attention={[]}
        recentProjects={[]}
      />,
    );

    expect(html).not.toContain("heatmap-legend");
    expect(html).not.toContain(">fewer<");
    expect(html).not.toContain(">more<");
  });
});
