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
    "feature/beacon",
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
  insertEvent.run(3, "e-stale", "started", "Task started", at(25));
  insertEvent.run(2, "e3", "tool", "Used Read", at(10));
  insertEvent.run(1, "e4", "completed", "Session completed", at(5));
  insertEvent.run(4, "e5", "started", "Task started", at(1));
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

  it("treats underscore, percent, and backslash literally in search", () => {
    const now = new Date().toISOString();
    const insert = sqlite.prepare(`INSERT INTO sessions
      (external_id, provider, title, status, started_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`);
    insert.run(
      "like-1",
      "codex",
      "fix_bug at 50% coverage",
      "completed",
      now,
      now,
    );
    insert.run("like-2", "codex", "fixzbug elsewhere", "completed", now, now);
    insert.run(
      "like-3",
      "codex",
      String.raw`path\to\repo`,
      "completed",
      now,
      now,
    );
    try {
      expect(queries.getSessions({ q: "fix_bug" }).map((s) => s.title)).toEqual(
        ["fix_bug at 50% coverage"],
      );
      expect(queries.getSessions({ q: "50%" })).toHaveLength(1);
      expect(queries.getSessions({ q: String.raw`path\to` })).toHaveLength(1);
    } finally {
      sqlite
        .prepare("DELETE FROM sessions WHERE external_id LIKE 'like-%'")
        .run();
    }
  });

  it("nests subagent sessions beneath their main session", () => {
    const now = new Date().toISOString();
    const insert = sqlite.prepare(`INSERT INTO sessions
      (external_id, provider, parent_external_id, session_kind, title, status, started_at, updated_at)
      VALUES (?, 'codex', ?, ?, ?, 'completed', ?, ?)`);
    insert.run("hierarchy-parent", null, "main", "Hierarchy parent", now, now);
    insert.run(
      "hierarchy-child",
      "hierarchy-parent",
      "subagent",
      "Hierarchy child",
      now,
      now,
    );
    try {
      const sessions = queries.getSessions({ q: "Hierarchy", range: "all" });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].children.map((child) => child.externalId)).toEqual([
        "hierarchy-child",
      ]);
    } finally {
      sqlite
        .prepare("DELETE FROM sessions WHERE external_id LIKE 'hierarchy-%'")
        .run();
    }
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

describe("project and overview queries", () => {
  it("counts sessions", () => {
    expect(queries.countSessions()).toBe(4);
  });

  it("shows Git-backed projects and groups other sessions as tasks", () => {
    const projects = queries.getProjects();
    expect(projects.map((project) => project.key).sort()).toEqual([
      "(tasks)",
      "beacon",
      "relay",
    ]);
    const beacon = projects.find((project) => project.key === "beacon");
    expect(beacon).toMatchObject({
      sessionCount: 1,
      activeCount: 1,
      providers: ["codex"],
    });
    const tasks = projects.find((project) => project.key === "(tasks)");
    expect(tasks).toMatchObject({
      repository: null,
      category: "task",
      sessionCount: 2,
    });
  });

  it("applies the shared session filters to project rollups", () => {
    const projects = queries.getProjects({ provider: "codex", range: "all" });
    expect(projects.map((project) => project.key).sort()).toEqual([
      "beacon",
      "relay",
    ]);
  });

  it("lists session history for a project", () => {
    expect(queries.getProjectSessions("relay")[0].title).toBe(
      "Build Relay filters",
    );
    const tasks = queries.getProjectSessions("(tasks)");
    expect(tasks).toHaveLength(2);
    expect(tasks.map((session) => session.title)).toEqual([
      "Stale runner",
      "Inspect agent cost",
    ]);
    expect(tasks[0].status).toBe("incomplete");
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

  it("keeps incomplete sessions out and includes all of yesterday", () => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);
    sqlite
      .prepare(
        `INSERT INTO sessions
         (external_id, provider, title, status, started_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "waiting-approval",
        "zcode",
        "Waiting for approval",
        "needs_attention",
        new Date(now.getTime() - 2 * 24 * 60 * 60_000).toISOString(),
        yesterday.toISOString(),
      );
    try {
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
      expect(attention.map((session) => session.title)).toContain(
        "Waiting for approval",
      );
    } finally {
      sqlite
        .prepare("DELETE FROM sessions WHERE external_id = ?")
        .run("waiting-approval");
    }
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

  it("attributes per-model cost even when a sibling model is unpriced", () => {
    const startedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    sqlite
      .prepare(
        `INSERT INTO sessions (external_id, provider, title, status, started_at, updated_at)
         VALUES ('mixed-1', 'codex', 'Mixed models', 'completed', ?, ?)`,
      )
      .run(startedAt, startedAt);
    const sessionId = (
      sqlite
        .prepare("SELECT id FROM sessions WHERE external_id = 'mixed-1'")
        .get() as { id: number }
    ).id;
    const insertUsage = sqlite.prepare(`INSERT INTO session_model_usage
      (session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reported_cost_usd)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    insertUsage.run(sessionId, "gpt-5.5", 1_000_000, 0, 0, 0, null);
    insertUsage.run(sessionId, "mystery-model-2", 1_000, 0, 0, 0, null);
    try {
      const summary = queries.getUsageSummary();
      // The session is excluded from window dollar sums (mystery-model-2 is
      // unpriced) but gpt-5.5's own cost still shows in the by-model chart.
      expect(summary.month.costUsd).toBeCloseTo(8, 6);
      expect(summary.month.unpricedSessions).toBe(2);
      const gpt = summary.byModel.find((bucket) => bucket.key === "gpt-5.5");
      // $8 from session 1 plus $5 (1M input) from the mixed session.
      expect(gpt?.costUsd).toBeCloseTo(13, 6);
      const mystery = summary.byModel.find(
        (bucket) => bucket.key === "mystery-model-2",
      );
      expect(mystery?.costUsd).toBe(0);
    } finally {
      sqlite
        .prepare("DELETE FROM session_model_usage WHERE session_id = ?")
        .run(sessionId);
      sqlite
        .prepare("DELETE FROM sessions WHERE external_id = 'mixed-1'")
        .run();
    }
  });
});

describe("overview patterns", () => {
  it("builds a 7x24 heatmap with counts from recent sessions", () => {
    const patterns = queries.getOverviewPatterns();
    expect(patterns.heatmap).toHaveLength(7 * 24);
    // Each cell carries its grid coordinates.
    expect(patterns.heatmap[0]).toMatchObject({ dayOfWeek: 0, hour: 0 });
    expect(patterns.heatmap.at(-1)).toMatchObject({ dayOfWeek: 6, hour: 23 });
    // Three sessions started within the 30-day window; their cells are > 0.
    const total = patterns.heatmap.reduce((sum, cell) => sum + cell.count, 0);
    expect(total).toBe(3);
  });

  it("buckets session length and summarizes the long tail", () => {
    const patterns = queries.getOverviewPatterns();
    expect(patterns.length.buckets).toHaveLength(5);
    // Bucket labels are stable and ordered shortest to longest; the last
    // bucket is open-ended so long sessions (> 2h) are not dropped.
    expect(patterns.length.buckets.map((b) => b.label)).toEqual([
      "< 2 min",
      "2–10 min",
      "10–30 min",
      "30 min–1h",
      "1h+",
    ]);
    expect(patterns.length.sessionCount).toBe(3);
    // Session 1 has 0 runtime (started = ended); sessions 3 and 4 are
    // "running" (no ended_at) so runtime falls back to updated_at, giving
    // ~2 days — both land in the open-ended "1h+" bucket.
    expect(patterns.length.buckets[0]?.count).toBe(1);
    expect(patterns.length.buckets.at(-1)?.count).toBe(2);
    // All runtime lives in long sessions (> 30 min): the long tail is 100%.
    expect(patterns.length.longTailShare).toBe(1);
    expect(patterns.length.longestMs).toBeGreaterThan(60 * 60_000);
  });

  it("reports week cost as null when any usage row is unpriced", () => {
    const patterns = queries.getOverviewPatterns();
    // Session 3 ("Stale runner", mystery-model) is in the 7-day window and
    // unpriced, so the week total must be unavailable even though other
    // sessions are priced.
    expect(patterns.costWeek.costUsd).toBeNull();
    // Token total still shows regardless of pricing.
    expect(patterns.costWeek.tokens).toBeGreaterThan(0);
  });

  it("buckets heatmap sessions in America/New_York time", () => {
    // This instant is Tuesday 00:30 UTC but Monday 20:30 EDT. Assert the
    // Eastern-time cell changes even when the UTC date belongs to another day.
    const tuesdayUtcMondayEastern = "2026-07-14T00:30:00.000Z";
    const before = queries.getOverviewPatterns();
    const beforeEasternCount =
      before.heatmap.find((cell) => cell.dayOfWeek === 0 && cell.hour === 20)
        ?.count ?? 0;
    sqlite
      .prepare(
        `INSERT INTO sessions (external_id, provider, title, status, started_at, updated_at)
         VALUES ('heat-eastern', 'codex', 'Heatmap placement check', 'completed', ?, ?)`,
      )
      .run(tuesdayUtcMondayEastern, tuesdayUtcMondayEastern);
    try {
      const patterns = queries.getOverviewPatterns();
      const easternCell = patterns.heatmap.find(
        (cell) => cell.dayOfWeek === 0 && cell.hour === 20,
      );
      expect(easternCell?.count).toBe(beforeEasternCount + 1);
    } finally {
      sqlite
        .prepare("DELETE FROM sessions WHERE external_id = 'heat-eastern'")
        .run();
    }
  });
});
