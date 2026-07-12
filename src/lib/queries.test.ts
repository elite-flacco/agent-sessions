import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let directory = "";
let sqlite: (typeof import("@/db/client"))["sqlite"];
let queries: typeof import("./queries");

beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "relay-queries-"));
  process.env.RELAY_DATABASE_PATH = path.join(directory, "relay.db");
  vi.resetModules();
  ({ sqlite } = await import("@/db/client"));
  queries = await import("./queries");
  const insert = sqlite.prepare(`INSERT INTO sessions
    (external_id, provider, title, repository, branch, status, started_at, updated_at, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const now = new Date();
  insert.run(
    "1",
    "codex",
    "Build Relay filters",
    "relay",
    "main",
    "completed",
    now.toISOString(),
    now.toISOString(),
    now.toISOString(),
  );
  insert.run(
    "2",
    "pi",
    "Inspect agent cost",
    "ai-compass",
    null,
    "interrupted",
    new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    now.toISOString(),
    null,
  );
  insert.run(
    "3",
    "zcode",
    "Stale runner",
    null,
    null,
    "running",
    new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    new Date(now.getTime() - 30 * 60_000).toISOString(),
    null,
  );
  insert.run(
    "4",
    "codex",
    "Fresh runner",
    "beacon",
    null,
    "running",
    new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    now.toISOString(),
    null,
  );
  const insertEvent = sqlite.prepare(`INSERT INTO activity_events
    (session_id, external_id, kind, title, occurred_at) VALUES (?, ?, ?, ?, ?)`);
  const at = (minutes: number) =>
    new Date(now.getTime() - minutes * 60_000).toISOString();
  insertEvent.run(1, "e1", "started", "Session started", at(30));
  insertEvent.run(1, "e2", "tool", "Used Bash", at(20));
  insertEvent.run(2, "e3", "tool", "Used Read", at(10));
  insertEvent.run(1, "e4", "completed", "Session completed", at(5));
  const insertSource = sqlite.prepare(`INSERT INTO ingestion_sources
    (path, provider, size, modified_at, fingerprint, last_synced_at, parse_state)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  insertSource.run("/tmp/a.jsonl", "codex", 10, 1, "fp-a", at(2), "ok");
  insertSource.run("/tmp/b.jsonl", "claude", 10, 1, "fp-b", at(2), "error");
  const insertScan = sqlite.prepare(`INSERT INTO adapter_scans
    (provider, last_scan_at, sources, imported, errors) VALUES (?, ?, ?, ?, ?)`);
  insertScan.run("codex", at(30), 1, 0, 0);
  insertScan.run("claude", at(1), 1, 0, 0);
  const insertUsage = sqlite.prepare(`INSERT INTO session_model_usage
    (session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reported_cost_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  insertUsage.run(1, "gpt-5.5", 1_000_000, 100_000, 0, 0, null);
  insertUsage.run(2, "z-ai/glm-5.2", 300, 30, 150, 0, 0.005);
  insertUsage.run(3, "mystery-model", 1_000, 100, 0, 0, null);
});

afterAll(async () => {
  sqlite.close();
  delete process.env.RELAY_DATABASE_PATH;
  await fs.rm(directory, { recursive: true, force: true });
});

describe("session queries", () => {
  it("searches task, repository, and branch fields", () => {
    expect(queries.getSessions({ q: "Relay" })).toHaveLength(1);
    expect(
      queries.getSessions({ q: "ai-compass", range: "all" })[0].provider,
    ).toBe("pi");
    expect(queries.getSessions({ q: "main" })).toHaveLength(1);
  });

  it("combines provider, status, and date filters", () => {
    expect(
      queries.getSessions({ provider: "codex", status: "completed" }),
    ).toHaveLength(1);
    expect(queries.getSessions({ provider: "pi", range: "7d" })).toHaveLength(
      0,
    );
    expect(queries.getSessions({ provider: "pi", range: "all" })).toHaveLength(
      1,
    );
  });

  it("calculates local summary metrics", () => {
    expect(queries.getSummary()).toMatchObject({
      sessionsToday: 1,
      activeNow: 1,
    });
  });

  it("derives incomplete status for stale running sessions at query time", () => {
    const running = queries.getSessions({ status: "running", range: "all" });
    expect(running.map((session) => session.title)).toEqual(["Fresh runner"]);
    const stale = queries
      .getSessions({ range: "all" })
      .find((session) => session.title === "Stale runner");
    expect(stale?.status).toBe("incomplete");
  });
});

describe("activity stream queries", () => {
  it("returns newest events first with session context", () => {
    const rows = queries.getActivityStream({});
    expect(rows.map((row) => row.title)).toEqual([
      "Session completed",
      "Used Read",
      "Used Bash",
      "Session started",
    ]);
    expect(rows[0].sessionTitle).toBe("Build Relay filters");
    expect(rows[1].provider).toBe("pi");
  });

  it("filters by provider and repository", () => {
    expect(queries.getActivityStream({ provider: "pi" })).toHaveLength(1);
    expect(queries.getActivityStream({ repo: "relay" })).toHaveLength(3);
    expect(queries.getActivityStream({ repo: "unknown" })).toHaveLength(0);
  });

  it("lists distinct repositories and counts sessions", () => {
    expect(queries.getRepositories()).toEqual([
      "ai-compass",
      "beacon",
      "relay",
    ]);
    expect(queries.countSessions()).toBe(4);
  });

  it("groups sessions into projects with an unknown-workspace bucket", () => {
    const projects = queries.getProjects();
    expect(projects.map((project) => project.key).sort()).toEqual([
      "(unknown)",
      "ai-compass",
      "beacon",
      "relay",
    ]);
    const beacon = projects.find((project) => project.key === "beacon");
    expect(beacon).toMatchObject({
      sessionCount: 1,
      activeCount: 1,
      providers: ["codex"],
    });
    const unknown = projects.find((project) => project.key === "(unknown)");
    expect(unknown?.repository).toBeNull();
    expect(unknown?.sessionCount).toBe(1);
  });

  it("lists session history for a project", () => {
    expect(queries.getProjectSessions("relay")[0].title).toBe(
      "Build Relay filters",
    );
    const unknown = queries.getProjectSessions("(unknown)");
    expect(unknown).toHaveLength(1);
    expect(unknown[0].title).toBe("Stale runner");
    expect(unknown[0].status).toBe("incomplete");
  });

  it("summarizes daily and weekly overview windows", () => {
    const overview = queries.getOverview();
    expect(overview.today.sessions).toBe(1);
    expect(overview.week.sessions).toBe(3);
    expect(overview.week.failures).toBe(0);
    expect(overview.daily).toHaveLength(14);
    expect(overview.daily.at(-1)?.count).toBeGreaterThanOrEqual(1);
    expect(overview.providerCounts[0]).toMatchObject({ provider: "codex" });
  });

  it("keeps incomplete sessions out of the attention list", () => {
    expect(
      queries.getRunningSessions().map((session) => session.title),
    ).toEqual(["Fresh runner"]);
    const attention = queries.getAttentionSessions();
    expect(attention.map((session) => session.title)).not.toContain(
      "Stale runner",
    );
    expect(
      attention.every((session) =>
        ["interrupted", "needs_attention"].includes(session.status),
      ),
    ).toBe(true);
  });

  it("reports collector health from ingestion and scan state", () => {
    expect(queries.getCollectorHealth()).toMatchObject({
      sources: 2,
      parseErrors: 1,
      recentSyncErrors: 0,
      connectedAgents: 1,
      delayedProviders: ["codex"],
    });
  });
});

describe("usage and cost queries", () => {
  it("estimates session cost from the pricing table", () => {
    const usage = queries.getSessionUsage(1);
    // 1M input * $5 + 0.1M output * $30 = $8 for gpt-5.5
    expect(usage.costUsd).toBeCloseTo(8, 6);
    expect(usage.costSource).toBe("estimated");
    expect(usage.models[0]?.model).toBe("gpt-5.5");
  });

  it("prefers provider-reported cost and labels it reported", () => {
    const usage = queries.getSessionUsage(2);
    expect(usage.costUsd).toBeCloseTo(0.005, 9);
    expect(usage.costSource).toBe("reported");
  });

  it("marks unpriced models and sessions without usage as unavailable", () => {
    const unpriced = queries.getSessionUsage(3);
    expect(unpriced.costUsd).toBeNull();
    expect(unpriced.costSource).toBe("unavailable");
    expect(queries.getSessionUsage(4).costSource).toBe("unavailable");
  });

  it("aggregates windows, buckets, and unpriced exclusions", () => {
    const summary = queries.getUsageSummary();
    // Only session 1 started today; session 3 (unpriced) is two days old
    // and session 2 is outside the 30-day window entirely.
    expect(summary.today.costUsd).toBeCloseTo(8, 6);
    expect(summary.today.unpricedSessions).toBe(0);
    expect(summary.month.unpricedSessions).toBe(1);
    expect(summary.month.tokens).toBe(1_100_000 + 1_100);
    const codex = summary.byProvider.find((bucket) => bucket.key === "codex");
    expect(codex?.costUsd).toBeCloseTo(8, 6);
    expect(summary.byModel.map((bucket) => bucket.key)).toContain("gpt-5.5");
    const unknown = summary.byProject.find(
      (bucket) => bucket.key === "(unknown)",
    );
    expect(unknown?.costUsd).toBe(0);
    expect(summary.daily).toHaveLength(30);
    expect(summary.daily.at(-1)?.costUsd).toBeCloseTo(8, 6);
  });
});
