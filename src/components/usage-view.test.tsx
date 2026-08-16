import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { UsageSummary } from "@/lib/queries";
import { UsageView } from "./usage-view";

vi.mock("next/navigation", () => ({
  usePathname: () => "/usage",
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("range=all"),
}));

describe("UsageView", () => {
  test("scopes every summary metric and chart to the selected range", () => {
    const usage: UsageSummary = {
      range: "all",
      selected: {
        costUsd: 12.5,
        tokens: 5_000,
        cacheReadTokens: 2_000,
        sessions: 4,
        unpricedSessions: 1,
      },
      today: {
        costUsd: 0,
        tokens: 0,
        cacheReadTokens: 0,
        sessions: 0,
        unpricedSessions: 0,
      },
      week: {
        costUsd: 0,
        tokens: 0,
        cacheReadTokens: 0,
        sessions: 0,
        unpricedSessions: 0,
      },
      month: {
        costUsd: 0,
        tokens: 0,
        cacheReadTokens: 0,
        sessions: 0,
        unpricedSessions: 0,
      },
      daily: [{ date: "2026-01-01", costUsd: 12.5, tokens: 5_000 }],
      byProvider: [],
      byModel: [],
      byProject: [],
    };

    const html = renderToStaticMarkup(<UsageView usage={usage} range="all" />);

    expect(html).toContain('aria-label="Usage range"');
    expect(html).toContain("Estimated cost, all time");
    expect(html).toContain("Tokens, all time");
    expect(html).toContain("Sessions, all time");
    expect(html).toContain("Cache reads, all time");
    expect(html).toContain("Daily cost, all time");
    expect(html).toContain('class="spark usage-spark-all"');
    expect(html).not.toContain("Last 30 days");
  });

  test("left-aligns model labels without changing right-aligned costs", () => {
    const styles = readFileSync(
      new URL("../app/globals.css", import.meta.url),
      "utf8",
    );

    expect(styles).toContain(`.dist-row-wide > .mono.dist-label {
    text-align: left;
  }`);
    expect(styles).toContain(`.dist-row .mono {
    text-align: right;`);
    expect(styles).toContain(`.usage-spark-all {
    gap: 0;
  }`);
  });
});
