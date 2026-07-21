import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { ProjectSummary, SessionListItem } from "@/lib/queries";
import { OverviewView } from "./overview-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function renderOverview(
  running: SessionListItem[] = [],
  recentProjects: ProjectSummary[] = [],
): string {
  return renderToStaticMarkup(
    <OverviewView
      overview={{
        today: { sessions: 0, runtimeMs: 0, events: 0 },
        week: { sessions: 0, runtimeMs: 0, events: 0, failures: 0 },
        providerCounts: [],
        daily: [],
      }}
      patterns={{
        heatmap: Array.from({ length: 30 * 8 }, (_, index) => ({
          day: new Date(Date.UTC(2026, 5, 19 + Math.floor(index / 8)))
            .toISOString()
            .slice(0, 10),
          band: index % 8,
          count: index % 4,
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
      recentProjects={recentProjects}
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

  test("uses neutral bullets for recent projects", () => {
    const html = renderOverview(
      [],
      [
        {
          key: "agent-sessions",
          repository: "agent-sessions",
          category: "project",
          sessionCount: 3,
          activeCount: 0,
          providers: ["codex"],
          branches: ["main"],
          workdirs: ["/workspace/agent-sessions"],
          totalRuntimeMs: 60_000,
          lastActivityAt: "2026-07-16T12:00:00.000Z",
        },
      ],
    );
    const styles = readFileSync(
      new URL("../app/globals.css", import.meta.url),
      "utf8",
    );

    expect(html).toContain(
      '<span class="project-list-marker" aria-hidden="true"></span>',
    );
    expect(html).not.toContain("lucide-layout-dashboard");
    expect(styles).toContain(`.recent-project-row {
    grid-template-columns: var(--status-dot-size) minmax(0, 1fr) auto;
    column-gap: var(--status-dot-gap);
  }`);
    expect(styles).toContain(`.project-list-marker {
    width: var(--status-dot-size);
    height: var(--status-dot-size);
    margin-top: var(--status-dot-offset);
    border-radius: var(--radius-pill);
    background: var(--muted-foreground);
  }`);
    expect(styles).toContain(`.recent-project-row p {
    line-height: var(--leading-normal);
  }`);
  });

  test("uses the KPI font size for the weekly cost total", () => {
    const styles = readFileSync(
      new URL("../app/globals.css", import.meta.url),
      "utf8",
    );

    expect(styles).toContain(`.cost-total strong {
    font-size: var(--text-xl);`);
  });

  test("describes the three-day needs-attention window", () => {
    const html = renderOverview();

    expect(html).toContain("Nothing needs attention in the past 3 days.");
    expect(html).not.toContain("today or yesterday");
  });

  test("renders the heatmap as actual dates by time of day", () => {
    const html = renderOverview();

    expect(html).toContain('class="heatmap-cal"');
    // Range label and per-cell tooltips use real dates plus a 3-hour band.
    expect(html).toContain("Jun 19 – Jul 18");
    expect(html).toContain('title="Jun 19 · 3–6 AM — 1 session"');
    expect(html).toContain('title="Jun 19 · 6–9 AM — 2 sessions"');
    // Sparse date labels along the x-axis, band labels down the y-axis.
    expect(html).toContain('class="heat-date-label"');
    expect(html).toContain(">12a<");
    expect(html).toContain(">9p<");
  });

  test("does not render a heatmap intensity legend", () => {
    const html = renderOverview();

    expect(html).not.toContain("heatmap-legend");
    expect(html).not.toContain(">fewer<");
    expect(html).not.toContain(">more<");
  });

  test("uses the warning color only for the needs-attention icon", () => {
    const html = renderOverview();

    expect(html).toContain('class="lucide lucide-triangle-alert warning-icon"');
    expect(html).not.toContain(
      'class="lucide lucide-folder-kanban warning-icon"',
    );
  });

  test("uses a live icon and a shared larger title gap on overview cards", () => {
    const html = renderOverview();
    const styles = readFileSync(
      new URL("../app/globals.css", import.meta.url),
      "utf8",
    );

    expect(html.match(/class="overview-card-title"/g)).toHaveLength(3);
    expect(html).toContain(
      'class="lucide lucide-circle-dot running-icon" aria-hidden="true"',
    );
    expect(styles).toContain("--card-title-icon-gap: 0.5rem;");
    expect(styles).toContain("gap: var(--card-title-icon-gap);");
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
        statusReason: null,
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
    expect(html).toContain('class="lucide lucide-circle" aria-hidden="true"');
    expect(html).not.toContain(
      'class="status-label status-running session-line-status"><i>',
    );
  });
});
