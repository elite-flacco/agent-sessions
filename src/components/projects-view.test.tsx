// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ProjectCostSummary, ProjectDetail } from "@/lib/queries";
import { ProjectsView } from "./projects-view";

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects",
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("project=relay"),
}));

afterEach(cleanup);

function baseProject(
  overrides: Partial<ProjectCostSummary> = {},
): ProjectCostSummary {
  return {
    key: "relay",
    repository: "relay",
    githubUrl: null,
    category: "project",
    sessionCount: 209,
    activeCount: 1,
    providers: ["claude"],
    branches: ["main"],
    workdirs: ["/repos/relay"],
    totalCostUsd: 241.35,
    unpricedSessionCount: 0,
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
    largestCostSessions: [],
    largestCostSession: null,
    byProvider: [],
    worktrees: [],
    ...overrides,
  };
}

describe("ProjectsView landing", () => {
  test("renders project summaries as links in the projects grid", () => {
    render(
      <ProjectsView
        projects={[
          baseProject(),
          baseProject({
            key: "ai-compass",
            repository: "ai-compass",
            activeCount: 0,
            providers: ["codex", "zcode"],
            sessionCount: 42,
            totalRuntimeMs: 7_200_000,
          }),
        ]}
        selected={null}
      />,
    );

    const grid = screen.getByLabelText("Projects with Git evidence");
    expect(grid).toHaveClass("projects-grid");
    expect(within(grid).getByRole("link", { name: /relay/i })).toHaveAttribute(
      "href",
      "/projects?project=relay",
    );
    expect(
      within(grid).getByRole("link", { name: /ai-compass/i }),
    ).toHaveAttribute("href", "/projects?project=ai-compass");
    expect(grid).toHaveTextContent("209 sessions");
    expect(grid).toHaveTextContent("Claude");
    expect(grid).toHaveTextContent("Codex");
    expect(grid).toHaveTextContent("Zcode");
    expect(
      within(grid).queryByRole("link", { name: /open .* on github/i }),
    ).not.toBeInTheDocument();
  });

  test("links a detected GitHub origin separately from the Agentarium briefing", () => {
    render(
      <ProjectsView
        projects={[
          baseProject({ githubUrl: "https://github.com/openai/relay" }),
        ]}
        selected={null}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Open relay project briefing" }),
    ).toHaveAttribute("href", "/projects?project=relay");
    const githubLink = screen.getByRole("link", {
      name: "Open relay on GitHub",
    });
    expect(githubLink).toHaveAttribute(
      "href",
      "https://github.com/openai/relay",
    );
    expect(githubLink).toHaveAttribute("target", "_blank");
    expect(githubLink).toHaveAttribute("rel", "noreferrer");
    expect(githubLink.querySelector('[data-icon="github"]')).toBeVisible();
  });

  test("shows each project's total cost", () => {
    render(
      <ProjectsView
        projects={[
          baseProject({
            totalCostUsd: 12.345,
            unpricedSessionCount: 2,
          }),
        ]}
        selected={null}
      />,
    );

    const card = screen.getByRole("article");
    expect(card).toHaveTextContent("209 sessions · 1h 0m · $12.35");
  });

  test("keeps the existing empty state when no projects have Git evidence", () => {
    render(<ProjectsView projects={[]} selected={null} />);

    expect(
      screen.getByRole("heading", {
        name: "No projects with local Git evidence yet",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Browse sessions" }),
    ).toHaveAttribute("href", "/sessions");
    expect(
      screen.queryByLabelText("Projects with Git evidence"),
    ).not.toBeInTheDocument();
  });
});

describe("ProjectsView briefing", () => {
  test("scopes the headline metrics to the selected range", () => {
    render(<ProjectsView projects={[]} selected={baseDetail()} />);
    const rollup = screen.getByLabelText("Project rollup");
    expect(rollup).toHaveTextContent("53");
    expect(rollup).toHaveTextContent("of 209 all time");
    expect(rollup).toHaveTextContent("$241.35");
  });

  test("labels all-time briefing evidence without saying last all time", () => {
    render(
      <ProjectsView projects={[]} selected={baseDetail({ range: "all" })} />,
    );

    expect(screen.getByLabelText("Project range")).toBeVisible();
    expect(screen.getByText(/events across all time/)).toBeVisible();
    expect(screen.queryByText(/last all time/)).not.toBeInTheDocument();
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

  test("shows the five most expensive sessions in ranked order", () => {
    render(
      <ProjectsView
        projects={[]}
        selected={baseDetail({
          largestCostSessions: [
            { id: 1, title: "Rank 1", provider: "codex", costUsd: 50 },
            { id: 2, title: "Rank 2", provider: "claude", costUsd: 40 },
            { id: 3, title: "Rank 3", provider: "zcode", costUsd: 30 },
            { id: 4, title: "Rank 4", provider: "codex", costUsd: 20 },
            { id: 5, title: "Rank 5", provider: "claude", costUsd: 10 },
            { id: 6, title: "Rank 6", provider: "zcode", costUsd: 5 },
          ] as ProjectDetail["largestCostSessions"],
        })}
      />,
    );

    const panel = screen.getByRole("region", {
      name: "Most expensive sessions",
    });
    const links = within(panel).getAllByRole("link");
    expect(links).toHaveLength(5);
    expect(links.map((link) => link.textContent)).toEqual([
      "Rank 1",
      "Rank 2",
      "Rank 3",
      "Rank 4",
      "Rank 5",
    ]);
    expect(links[0]).toHaveAttribute("href", "/sessions/1");
    expect(within(links[0]).getByText("Rank 1")).toHaveClass(
      "block",
      "text-xs",
      "font-semibold",
      "leading-normal",
    );
    expect(within(panel).getAllByText("Codex")[0]).toBeVisible();
    expect(panel).toHaveTextContent("$50.00");
    expect(
      within(panel).queryByRole("link", { name: "Rank 6" }),
    ).not.toBeInTheDocument();
  });

  test("explains when the selected range has no fully priced sessions", () => {
    render(<ProjectsView projects={[]} selected={baseDetail()} />);

    expect(
      within(
        screen.getByRole("region", { name: "Most expensive sessions" }),
      ).getByText("No fully priced sessions in this range."),
    ).toBeVisible();
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

  test("identifies activity by its session and coding agent", () => {
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
    expect(screen.getByText(/Claude Code/)).toBeInTheDocument();
    expect(screen.queryByText(/Run completed/)).not.toBeInTheDocument();
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
