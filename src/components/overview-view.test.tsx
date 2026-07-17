import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { SessionListItem } from "@/lib/queries";
import { OverviewView } from "./overview-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function renderOverview(running: SessionListItem[] = []): string {
  return renderToStaticMarkup(
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
      running={running}
      attention={[]}
      recentProjects={[]}
    />,
  );
}

describe("OverviewView", () => {
  test("prioritizes weekly and daily sessions without a failures metric", () => {
    const html = renderOverview();
    const summary = html.slice(
      html.indexOf('<div class="summary-grid'),
      html.indexOf('<div class="overview-grid">'),
    );

    expect(summary).toContain('class="summary-grid overview-summary-grid"');
    expect(summary.match(/class="metric metric-link"/g)).toHaveLength(3);
    expect(summary.indexOf("Sessions this week")).toBeLessThan(
      summary.indexOf("Sessions today"),
    );
    expect(summary.indexOf("Sessions today")).toBeLessThan(
      summary.indexOf("Running now"),
    );
    expect(summary).not.toContain("Failures this week");
  });

  test("uses three overview metrics and lets the last one span mobile", () => {
    const styles = readFileSync(
      new URL("../app/globals.css", import.meta.url),
      "utf8",
    );

    expect(styles).toContain(`.overview-summary-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }`);
    expect(styles).toContain(`.overview-summary-grid .metric:last-child {
      grid-column: 1 / -1;
    }`);
  });

  test("top-aligns recent-project icons with a compact text gap", () => {
    const styles = readFileSync(
      new URL("../app/globals.css", import.meta.url),
      "utf8",
    );

    expect(styles).toContain(`.project-session-row {
    display: grid;
    grid-template-columns: 1.1rem minmax(0, 1fr) auto;
    gap: var(--tag-icon-gap);
    align-items: start;`);
    expect(styles).toContain(`.project-session-row > span {
    display: flex;
    align-items: flex-start;
  }`);
  });

  test("does not render a heatmap intensity legend", () => {
    const html = renderOverview();

    expect(html).not.toContain("heatmap-legend");
    expect(html).not.toContain(">fewer<");
    expect(html).not.toContain(">more<");
  });

  test("uses the warning color only for the needs-attention icon", () => {
    const html = renderOverview();

    expect(html).toContain(
      'class="lucide lucide-triangle-alert inline-icon warning-icon"',
    );
    expect(html).not.toContain(
      'class="lucide lucide-folder-kanban inline-icon warning-icon"',
    );
  });

  test("uses compact, top-aligned status dots for running-session rows", () => {
    const html = renderOverview([
      {
        id: 1,
        externalId: "session-1",
        provider: "codex",
        parentExternalId: null,
        sessionKind: "main",
        agentLabel: null,
        agentDepth: 0,
        title: "Running session",
        summary: null,
        repository: "agent-sessions",
        cwd: "/workspace/agent-sessions",
        branch: "main",
        status: "running",
        startedAt: "2026-07-15T12:00:00.000Z",
        endedAt: null,
        updatedAt: "2026-07-15T12:05:00.000Z",
        inputTokens: null,
        outputTokens: null,
        cachedTokens: null,
        model: null,
        estimatedCostUsd: null,
      },
    ]);

    expect(html).toContain('class="project-session-row session-line-row"');
    expect(html).toContain(
      'class="status-label status-running session-line-status"',
    );
  });
});
