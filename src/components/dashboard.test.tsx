import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { SessionTreeItem } from "@/lib/queries";
import { Dashboard } from "./dashboard";

vi.mock("next/navigation", () => ({
  usePathname: () => "/sessions",
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}));

function session(
  id: number,
  title: string,
  children: SessionTreeItem[] = [],
): SessionTreeItem {
  return {
    id,
    externalId: `session-${id}`,
    provider: "codex",
    parentExternalId: null,
    sessionKind: "main",
    agentLabel: null,
    agentDepth: 0,
    title,
    summary: null,
    repository: "agent-sessions",
    cwd: "/workspace/agent-sessions",
    branch: "main",
    status: "completed",
    startedAt: "2026-07-15T12:00:00.000Z",
    endedAt: "2026-07-15T12:05:00.000Z",
    updatedAt: "2026-07-15T12:05:00.000Z",
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
    model: null,
    estimatedCostUsd: null,
    children,
  };
}

describe("Dashboard session rows", () => {
  test("balances session filters before the desktop row overflows", () => {
    const styles = readFileSync(
      new URL("../app/globals.css", import.meta.url),
      "utf8",
    );

    expect(styles).toContain(`@media (max-width: 1100px) {
  @layer components {
    .session-filter-row {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .session-filter-row .search-control {
      grid-column: 1 / -1;
    }
  }
}`);
  });

  test("uses the single-row desktop layout for all session filters", () => {
    const html = renderToStaticMarkup(
      <Dashboard
        sessions={[]}
        projects={[]}
        summary={{
          sessionsToday: 0,
          activeNow: 0,
          totalRuntimeMs: 0,
          connectedAgents: 0,
        }}
        syncState={{ lastSyncedAt: null, errors: 0, sources: 0 }}
        costToday={{
          costUsd: 0,
          tokens: 0,
          cacheReadTokens: 0,
          sessions: 0,
          unpricedSessions: 0,
        }}
        filters={{}}
        view="sessions"
      />,
    );

    expect(html).toContain('<div class="filter-row session-filter-row">');
  });

  test("omits title action icons and hides branches for sessions without subagents", () => {
    const child = {
      ...session(3, "Child session"),
      parentExternalId: "session-2",
      sessionKind: "subagent" as const,
      agentDepth: 1,
    };
    const html = renderToStaticMarkup(
      <Dashboard
        sessions={[
          session(1, "Standalone session"),
          session(2, "Parent session", [child]),
        ]}
        projects={[]}
        summary={{
          sessionsToday: 2,
          activeNow: 0,
          totalRuntimeMs: 600_000,
          connectedAgents: 1,
        }}
        syncState={{ lastSyncedAt: null, errors: 0, sources: 2 }}
        costToday={{
          costUsd: 0,
          tokens: 0,
          cacheReadTokens: 0,
          sessions: 0,
          unpricedSessions: 0,
        }}
        filters={{}}
        view="sessions"
      />,
    );

    expect(html).not.toContain("session-open-link");
    expect(html).not.toContain("Open Standalone session in a new tab");
    expect(html).toContain(
      'Standalone session</a></div><span class="mono session-meta"><span class="session-meta-text">agent-sessions</span></span>',
    );
    expect(html).toContain(
      'Parent session</a></div><span class="mono session-meta"><span class="session-meta-text">agent-sessions · main</span>',
    );
    expect(html).toContain("1 subagent");
  });

  test("keeps the subagent toggle outside the truncating meta text", () => {
    const child = {
      ...session(3, "Child session"),
      parentExternalId: "session-2",
      sessionKind: "subagent" as const,
      agentDepth: 1,
    };
    const html = renderToStaticMarkup(
      <Dashboard
        sessions={[
          session(2, "Parent with a very long branch", [
            { ...child, branch: "feature/extremely-long-branch-name" },
          ]),
        ]}
        projects={[]}
        summary={{
          sessionsToday: 1,
          activeNow: 0,
          totalRuntimeMs: 600_000,
          connectedAgents: 1,
        }}
        syncState={{ lastSyncedAt: null, errors: 0, sources: 1 }}
        costToday={{
          costUsd: 0,
          tokens: 0,
          cacheReadTokens: 0,
          sessions: 0,
          unpricedSessions: 0,
        }}
        filters={{}}
        view="sessions"
      />,
    );
    const styles = readFileSync(
      new URL("../app/globals.css", import.meta.url),
      "utf8",
    );

    // The repo · branch text truncates in its own span; the toggle is a flex
    // sibling that cannot shrink, so a long branch can never clip it.
    expect(html).toContain(
      '</span><button class="subagent-toggle" aria-expanded="false">',
    );
    expect(styles).toContain(`.session-primary .session-meta {
    display: flex;
    align-items: center;
    min-width: 0;
  }`);
    expect(styles).toContain(`.subagent-toggle {
    display: inline-flex;
    flex-shrink: 0;`);
  });
});
