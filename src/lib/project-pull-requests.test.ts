import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ProjectCostSummary } from "@/lib/queries";
import {
  attachOpenPullRequestCounts,
  clearPullRequestCountCache,
} from "./project-pull-requests";

function pullRequestResponse(options: {
  body?: unknown;
  link?: string;
  ok?: boolean;
}): Response {
  return new Response(JSON.stringify(options.body ?? []), {
    status: options.ok === false ? 403 : 200,
    headers: { ...(options.link ? { Link: options.link } : {}) },
  });
}

function project(
  overrides: Partial<Pick<ProjectCostSummary, "key" | "githubUrl">> = {},
): ProjectCostSummary {
  return {
    key: "relay",
    repository: "relay",
    githubUrl: null,
    category: "project",
    sessionCount: 1,
    activeCount: 0,
    providers: ["claude"],
    branches: ["main"],
    workdirs: ["/repos/relay"],
    totalRuntimeMs: 1_000,
    lastActivityAt: "2026-08-03T10:00:00.000Z",
    totalCostUsd: null,
    unpricedSessionCount: 0,
    openPullRequestCount: null,
    ...overrides,
  };
}

beforeEach(() => {
  clearPullRequestCountCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GITHUB_TOKEN;
});

describe("attachOpenPullRequestCounts", () => {
  test("counts multi-page pull requests from the Link header's last page", async () => {
    const fetch = vi.fn(async () =>
      pullRequestResponse({
        body: [{ id: 1 }],
        link: '<https://api.github.com/repos/openai/relay/pulls?state=open&per_page=1&page=2>; rel="next", <https://api.github.com/repos/openai/relay/pulls?state=open&per_page=1&page=7>; rel="last"',
      }),
    );
    const [enriched] = await attachOpenPullRequestCounts(
      [project({ githubUrl: "https://github.com/openai/relay" })],
      { fetch: fetch as unknown as typeof globalThis.fetch },
    );
    expect(enriched.openPullRequestCount).toBe(7);
    expect(fetch).toHaveBeenCalledOnce();
  });

  test("falls back to the returned items without a Link header", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(pullRequestResponse({ body: [{ id: 1 }] }))
      .mockResolvedValueOnce(pullRequestResponse({ body: [] }));
    const [single, none] = await attachOpenPullRequestCounts(
      [
        project({ key: "one", githubUrl: "https://github.com/openai/one" }),
        project({ key: "none", githubUrl: "https://github.com/openai/none" }),
      ],
      { fetch: fetch as unknown as typeof globalThis.fetch },
    );
    expect(single.openPullRequestCount).toBe(1);
    expect(none.openPullRequestCount).toBe(0);
  });

  test("leaves the count null without a GitHub remote, a usable URL, or a successful lookup", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(pullRequestResponse({ ok: false }))
      .mockRejectedValueOnce(new Error("offline"));
    const [noUrl, failing, rejected] = await attachOpenPullRequestCounts(
      [
        project({ key: "local-only" }),
        project({
          key: "failing",
          githubUrl: "https://github.com/openai/failing",
        }),
        project({
          key: "rejected",
          githubUrl: "https://github.com/openai/rejected",
        }),
      ],
      { fetch: fetch as unknown as typeof globalThis.fetch },
    );
    expect(noUrl.openPullRequestCount).toBeNull();
    expect(failing.openPullRequestCount).toBeNull();
    expect(rejected.openPullRequestCount).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("serves repeated dashboard refreshes from cache and refetches after the TTL", async () => {
    let fetched = 0;
    const fetch = vi.fn(async () => {
      fetched += 1;
      return pullRequestResponse({ body: [] });
    });
    const url = "https://github.com/openai/relay";
    const dependencies = {
      fetch: fetch as unknown as typeof globalThis.fetch,
    };
    let clock = 0;
    const first = await attachOpenPullRequestCounts(
      [project({ githubUrl: url })],
      {
        ...dependencies,
        now: () => clock,
      },
    );
    const second = await attachOpenPullRequestCounts(
      [project({ githubUrl: url })],
      {
        ...dependencies,
        now: () => clock + 10_000,
      },
    );
    expect(first[0].openPullRequestCount).toBe(0);
    expect(second[0].openPullRequestCount).toBe(0);
    expect(fetched).toBe(1);

    clock = 6 * 60 * 1000;
    const third = await attachOpenPullRequestCounts(
      [project({ githubUrl: url })],
      {
        ...dependencies,
        now: () => clock,
      },
    );
    expect(third[0].openPullRequestCount).toBe(0);
    expect(fetched).toBe(2);
  });

  test("fetches one repository once when several projects share its remote", async () => {
    const fetch = vi.fn(async () => pullRequestResponse({ body: [{ id: 1 }] }));
    const url = "https://github.com/openai/relay";
    const enriched = await attachOpenPullRequestCounts(
      [
        project({ key: "relay", githubUrl: url }),
        project({ key: "relay-2", githubUrl: url }),
      ],
      { fetch: fetch as unknown as typeof globalThis.fetch },
    );
    expect(enriched.map((item) => item.openPullRequestCount)).toEqual([1, 1]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  test("authenticates with GITHUB_TOKEN when one is configured", async () => {
    process.env.GITHUB_TOKEN = "token-123";
    const fetch = vi.fn(async () => pullRequestResponse({ body: [] }));
    await attachOpenPullRequestCounts(
      [project({ githubUrl: "https://github.com/openai/relay" })],
      { fetch: fetch as unknown as typeof globalThis.fetch },
    );
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer token-123",
    );
  });
});
