// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ProjectDetail, ProjectSummary } from "@/lib/queries";
import { ProjectsView } from "./projects-view";

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects",
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("project=relay"),
}));

afterEach(cleanup);

function baseProject(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    key: "relay",
    repository: "relay",
    category: "project",
    sessionCount: 209,
    activeCount: 1,
    providers: ["claude"],
    branches: ["main"],
    workdirs: ["/repos/relay"],
    totalRuntimeMs: 3_600_000,
    lastActivityAt: "2026-08-03T10:00:00.000Z",
    ...overrides,
  };
}

function baseDetail(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    project: baseProject(),
    range: "7d",
    evidenceFilter: "all",
    windowSessionCount: 53,
    windowRuntimeMs: 3_600_000,
    state: "active",
    currentFocus: null,
    attention: [],
    sessions: [],
    sessionsTruncated: false,
    activity: [],
    totalCostUsd: 241.35,
    unpricedSessionCount: 0,
    costTrend: [
      { date: "2026-08-01", costUsd: 10 },
      { date: "2026-08-02", costUsd: 95.5 },
    ],
    largestCostSession: null,
    byProvider: [],
    worktrees: [],
    ...overrides,
  };
}

describe("ProjectsView briefing", () => {
  test("scopes the headline metrics to the selected range", () => {
    render(<ProjectsView projects={[]} selected={baseDetail()} />);
    const rollup = screen.getByLabelText("Project rollup");
    expect(rollup).toHaveTextContent("53");
    expect(rollup).toHaveTextContent("of 209 all time");
    expect(rollup).toHaveTextContent("$241.35");
  });

  test("names the most expensive session rather than leading with its cost", () => {
    render(
      <ProjectsView
        projects={[]}
        selected={baseDetail({
          largestCostSession: {
            id: 7,
            title: "Redesign the setup inventory",
            costUsd: 29.55,
          } as ProjectDetail["largestCostSession"],
        })}
      />,
    );
    const rollup = screen.getByLabelText("Project rollup");
    expect(rollup).toHaveTextContent("Redesign the setup inventory");
    expect(rollup).toHaveTextContent("$29.55 · incl. subagents");
  });

  test("says how many sessions the cost excluded when pricing is incomplete", () => {
    render(
      <ProjectsView
        projects={[]}
        selected={baseDetail({ unpricedSessionCount: 4 })}
      />,
    );
    expect(screen.getByLabelText("Project rollup")).toHaveTextContent(
      "4 unpriced sessions excluded",
    );
  });

  test("identifies activity by its session, not by the generic event title", () => {
    render(
      <ProjectsView
        projects={[]}
        selected={baseDetail({
          activity: [
            {
              kind: "completed",
              sessionId: 12,
              sessionTitle: "Worktree navigation",
              provider: "claude",
              status: "completed",
              occurredAt: "2026-08-03T10:00:00.000Z",
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("Worktree navigation")).toBeInTheDocument();
    expect(screen.getByText(/Run completed/)).toBeInTheDocument();
    expect(screen.queryByText("Task completed")).not.toBeInTheDocument();
  });

  test("pairs each worktree with the branches seen in it", () => {
    render(
      <ProjectsView
        projects={[]}
        selected={baseDetail({
          worktrees: [
            {
              workdir: "/repos/relay",
              branches: ["main", "claude/feat/projects"],
              sessionCount: 206,
              lastActivityAt: "2026-08-03T10:00:00.000Z",
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("main, claude/feat/projects")).toBeInTheDocument();
  });

  test("keeps the range in the evidence filter links", () => {
    render(
      <ProjectsView
        projects={[]}
        selected={baseDetail({ range: "30d", attention: [] })}
      />,
    );
    const filter = screen.getByLabelText("Evidence filter");
    expect(
      within(filter).getByRole("link", { name: /Needs attention/ }),
    ).toHaveAttribute(
      "href",
      "/projects?project=relay&range=30d&evidence=attention",
    );
  });

  test("shows the spend trend only when the range has priced spend", () => {
    render(
      <ProjectsView
        projects={[]}
        selected={baseDetail({
          costTrend: [{ date: "2026-08-01", costUsd: 0 }],
        })}
      />,
    );
    const spend = screen.getByRole("region", { name: "Spend trend" });
    expect(spend).toHaveTextContent("No priced spend in this range.");
  });
});
