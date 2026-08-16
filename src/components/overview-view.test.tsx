import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type {
  OverviewRange,
  ProjectSummary,
  SessionListItem,
} from "@/lib/queries";
import { OverviewView } from "./overview-view";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function renderOverview(
  running: SessionListItem[] = [],
  recentProjects: ProjectSummary[] = [],
  range: OverviewRange = "7d",
): string {
  return renderToStaticMarkup(
    <OverviewView
      range={range}
      overview={{
        today: { sessions: 0, runtimeMs: 0, events: 0 },
        week: { sessions: 0, runtimeMs: 0, events: 0, failures: 0 },
        providerCounts: [],
        daily: [],
      }}
      patterns={{
        // The heatmap always spans 30 days regardless of the selected range.
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

    expect(summary).toContain('class="summary-grid"');
    expect(summary.match(/class="metric metric-link"/g)).toHaveLength(4);
    expect(summary.indexOf("Sessions this week")).toBeLessThan(
      summary.indexOf("Sessions today"),
    );
    expect(summary.indexOf("Sessions today")).toBeLessThan(
      summary.indexOf("Running now"),
    );
    expect(summary.indexOf("Running now")).toBeLessThan(
      summary.indexOf("Cost this week"),
    );
    expect(summary).not.toContain("Failures this week");
  });

  test("surfaces a week-cost metric that links to the usage breakdown", () => {
    const html = renderOverview();
    const summary = html.slice(
      html.indexOf('<div class="summary-grid'),
      html.indexOf('<div class="overview-grid">'),
    );

    // Unpriced weeks render an em dash with an "Unavailable" caveat.
    expect(summary).toContain("Cost this week");
    expect(summary).toContain(">—<");
    expect(summary).toContain("Unavailable · ");
    // The cost tile is the summary's only link into the usage breakdown.
    expect(summary).toContain('href="/usage"');
  });

  test("uses the default four-up summary grid with no overview override", () => {
    const styles = readFileSync(
      new URL("../app/globals.css", import.meta.url),
      "utf8",
    );

    expect(styles).not.toContain(".overview-summary-grid");
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
    // The 30-day heatmap fixture spans Jun 19 – Jul 18.
    const html = renderOverview([], [], "30d");

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

  test("keeps the heatmap on a 30-day span at every range", () => {
    // The heatmap is always 30 days — a week is too sparse for the grid —
    // so it must read the same regardless of the selected range toggle.
    const sevenDayHtml = renderOverview([], [], "7d");
    const thirtyDayHtml = renderOverview([], [], "30d");

    const span = "Jun 19 – Jul 18";
    const aria =
      'aria-label="Sessions by day and time of day over the last 30 days"';
    expect(sevenDayHtml).toContain(span);
    expect(sevenDayHtml).toContain(aria);
    expect(thirtyDayHtml).toContain(span);
    expect(thirtyDayHtml).toContain(aria);
  });

  test("mounts a 7/30-day range toggle with the active option selected", () => {
    const sevenDayHtml = renderOverview([], [], "7d");
    const thirtyDayHtml = renderOverview([], [], "30d");

    // Both buttons render with aria-pressed reflecting the active range.
    expect(sevenDayHtml).toContain('aria-pressed="true">7 days');
    expect(sevenDayHtml).toContain('aria-pressed="false">30 days');
    expect(thirtyDayHtml).toContain('aria-pressed="false">7 days');
    expect(thirtyDayHtml).toContain('aria-pressed="true">30 days');
    // Active button carries the accent class.
    expect(sevenDayHtml).toContain("btn btn-accent");
    expect(sevenDayHtml).toContain("btn btn-outline");
  });

  test("labels the summary and cost card with the active range", () => {
    const sevenDayHtml = renderOverview([], [], "7d");
    const thirtyDayHtml = renderOverview([], [], "30d");

    expect(sevenDayHtml).toContain("Sessions this week");
    expect(sevenDayHtml).toContain("Cost this week");
    expect(sevenDayHtml).toContain("last seven days");
    expect(thirtyDayHtml).toContain("Sessions last 30 days");
    expect(thirtyDayHtml).toContain("Cost last 30 days");
    expect(thirtyDayHtml).toContain("last thirty days");
  });

  test("uses honest all-time copy without falling through to 30 days", () => {
    const html = renderOverview([], [], "all");

    expect(html).toContain("Sessions all time");
    expect(html).toContain("Cost all time");
    expect(html).toContain("all recorded sessions");
    expect(html).not.toContain("Sessions last 30 days");
    expect(html).not.toContain("last all time");
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
