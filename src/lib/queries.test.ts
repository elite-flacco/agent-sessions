import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { UNKNOWN_MODEL_KEY } from "@/lib/types";

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

  it("groups and filters sessions by canonical model", () => {
    const now = new Date().toISOString();
    const insert = sqlite.prepare(`INSERT INTO sessions
      (external_id, provider, title, model, status, started_at, updated_at)
      VALUES (?, 'codex', ?, ?, 'completed', ?, ?)`);
    insert.run("model-a", "Opus plain", "claude-opus-4-8", now, now);
    insert.run(
      "model-b",
      "Opus snapshot",
      "claude-opus-4-8-20251001",
      now,
      now,
    );
    insert.run("model-c", "GLM via prefix", "z-ai/glm-5.2", now, now);
    insert.run("model-d", "No model", null, now, now);
    try {
      const options = queries.getModelOptions();
      const opus = options.find((o) => o.value === "claude-opus-4-8");
      // Snapshot and plain ids collapse to one canonical option.
      expect(opus?.sessionCount).toBe(2);
      // z-ai/ is a kept source prefix: it does not collapse into glm-5.2 but
      // forms its own canonical option.
      expect(options.map((o) => o.value)).toContain("z-ai/glm-5.2");
      expect(options.map((o) => o.value)).not.toContain("glm-5.2");
      const zai = options.find((o) => o.value === "z-ai/glm-5.2");
      expect(zai && zai.sessionCount).toBe(1);
      const unknown = options.find((o) => o.value === UNKNOWN_MODEL_KEY);
      expect(unknown && unknown.sessionCount).toBeGreaterThanOrEqual(1);

      // Selecting a canonical id returns every raw variant of it.
      const opusSessions = queries.getSessions({
        model: "claude-opus-4-8",
        range: "all",
      });
      expect(opusSessions.map((s) => s.externalId).sort()).toEqual([
        "model-a",
        "model-b",
      ]);

      // The unknown option isolates null/empty-model sessions.
      const unknownSessions = queries.getSessions({
        model: UNKNOWN_MODEL_KEY,
        range: "all",
      });
      const unknownIds = unknownSessions.map((s) => s.externalId);
      expect(unknownIds).toContain("model-d");
      expect(unknownIds).not.toContain("model-a");

      // An id with no matching sessions returns nothing, not everything.
      expect(
        queries.getSessions({ model: "no-such-model", range: "all" }),
      ).toHaveLength(0);
    } finally {
      sqlite
        .prepare("DELETE FROM sessions WHERE external_id LIKE 'model-%'")
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

  it("sorts sessions by last update by default", () => {
    const now = Date.now();
    const insert = sqlite.prepare(`INSERT INTO sessions
      (external_id, provider, title, status, started_at, updated_at)
      VALUES (?, 'codex', ?, 'completed', ?, ?)`);
    insert.run(
      "updated-first",
      "Update order — older start, newer update",
      new Date(now - 2 * 60 * 60_000).toISOString(),
      new Date(now - 5 * 60_000).toISOString(),
    );
    insert.run(
      "started-first",
      "Update order — newer start, older update",
      new Date(now - 60 * 60_000).toISOString(),
      new Date(now - 30 * 60_000).toISOString(),
    );
    try {
      expect(
        queries
          .getSessions({ q: "Update order", range: "all" })
          .map((session) => session.title),
      ).toEqual([
        "Update order — older start, newer update",
        "Update order — newer start, older update",
      ]);
    } finally {
      sqlite
        .prepare("DELETE FROM sessions WHERE external_id IN (?, ?)")
        .run("updated-first", "started-first");
    }
  });

  it("calculates local summary metrics", () => {
    expect(queries.getSummary()).toMatchObject({
      sessionsToday: 1,
      activeNow: 1,
    });
  });

  it("filters sessions by project repository", () => {
    expect(
      queries.getSessions({ project: "relay", range: "all" }).map((s) => s.id),
    ).toHaveLength(1);
    expect(
      queries.getSessions({ project: "ai-compass", range: "all" })[0].provider,
    ).toBe("pi");
    expect(queries.getSessions({ project: "all", range: "all" })).toHaveLength(
      4,
    );
  });

  it("groups sessions without a repository under the unknown project key", () => {
    const unknown = queries.getSessions({
      project: "(unknown)",
      range: "all",
    });
    expect(unknown.map((s) => s.title)).toEqual(["Stale runner"]);
  });

  it("lists only git-backed project options with session counts", () => {
    const options = queries.getProjectOptions();
    const keys = options.map((option) => option.key);
    // "relay" (branch main) and "beacon" (feature/beacon) are Git-backed.
    expect(keys).toEqual(expect.arrayContaining(["relay", "beacon"]));
    // "ai-compass" has no branch or Git workdir, and null-repo sessions are
    // tasks — neither belongs in the repository filter.
    expect(keys).not.toContain("ai-compass");
    expect(keys).not.toContain("(unknown)");
    expect(options.find((option) => option.key === "relay")).toMatchObject({
      label: "relay",
      sessionCount: 1,
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

  it("builds a briefing only for safely established projects", () => {
    expect(queries.getProjectDetail("(tasks)")).toBeNull();
    const detail = queries.getProjectDetail("beacon");
    expect(detail).toMatchObject({
      state: "active",
      currentFocus: { title: "Fresh runner" },
      attention: [],
      range: "7d",
      evidenceFilter: "all",
    });
    expect(detail?.project.repository).toBe("beacon");
  });

  it("scopes briefing rollups to the selected range", () => {
    const stale = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    sqlite
      .prepare(
        `INSERT INTO sessions
        (external_id, provider, title, repository, branch, status, started_at, updated_at)
        VALUES (?, 'codex', ?, 'beacon', 'feature/beacon', 'completed', ?, ?)`,
      )
      .run("project-old", "Old beacon run", stale, stale);
    try {
      // 20 days back: outside the 7d window, inside the 30d one.
      expect(queries.getProjectDetail("beacon")?.windowSessionCount).toBe(1);
      expect(
        queries.getProjectDetail("beacon", "30d")?.windowSessionCount,
      ).toBe(2);
      expect(queries.getProjectDetail("beacon", "30d")?.costTrend).toHaveLength(
        30,
      );
    } finally {
      sqlite
        .prepare("DELETE FROM sessions WHERE external_id = ?")
        .run("project-old");
    }
  });

  it("includes sessions older than 30 days in all-time rollups", () => {
    const old = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    const overviewBefore = queries.getOverview("all").week.sessions;
    const patternsBefore =
      queries.getOverviewPatterns("all").length.sessionCount;
    sqlite
      .prepare(
        `INSERT INTO sessions
        (external_id, provider, title, repository, branch, status, started_at, updated_at)
        VALUES (?, 'codex', ?, 'beacon', 'feature/beacon', 'completed', ?, ?)`,
      )
      .run("project-all-time", "Old all-time beacon run", old, old);

    try {
      expect(queries.getOverview("30d").week.sessions).toBeLessThan(
        queries.getOverview("all").week.sessions,
      );
      expect(queries.getOverview("all").week.sessions).toBe(overviewBefore + 1);
      expect(
        queries.getProjectDetail("beacon", "all")?.windowSessionCount,
      ).toBe(
        (queries.getProjectDetail("beacon", "30d")?.windowSessionCount ?? 0) +
          1,
      );
      expect(queries.getOverviewPatterns("all").length.sessionCount).toBe(
        patternsBefore + 1,
      );
    } finally {
      sqlite
        .prepare("DELETE FROM sessions WHERE external_id = ?")
        .run("project-all-time");
    }
  });

  it("ends the seven-day project cost trend on today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T17:00:00.000Z"));
    const insert = sqlite.prepare(`INSERT INTO sessions
      (external_id, provider, title, repository, branch, status, started_at, updated_at)
      VALUES (?, 'codex', ?, 'calendar-test', 'main', 'completed', ?, ?)`);
    insert.run(
      "calendar-today",
      "Today's priced run",
      "2026-08-16T16:00:00.000Z",
      "2026-08-16T16:30:00.000Z",
    );
    sqlite
      .prepare(
        `INSERT INTO session_model_usage
        (session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reported_cost_usd)
        SELECT id, 'gpt-5.6-sol', 0, 0, 0, 0, 1
        FROM sessions WHERE external_id = ?`,
      )
      .run("calendar-today");

    try {
      expect(
        queries
          .getProjectDetail("calendar-test", "7d")
          ?.costTrend.map((day) => day.date),
      ).toEqual([
        "2026-08-10",
        "2026-08-11",
        "2026-08-12",
        "2026-08-13",
        "2026-08-14",
        "2026-08-15",
        "2026-08-16",
      ]);
      expect(
        queries.getProjectDetail("calendar-test", "7d")?.costTrend.at(-1),
      ).toEqual({ date: "2026-08-16", costUsd: 1 });
    } finally {
      sqlite
        .prepare("DELETE FROM sessions WHERE external_id = ?")
        .run("calendar-today");
      vi.useRealTimers();
    }
  });

  it("counts each session once in the project cost rollup", () => {
    // A parent and its subagent both live in the project. Summing the subtree
    // roll-ups would bill the child's spend twice.
    const now = new Date().toISOString();
    const insert = sqlite.prepare(`INSERT INTO sessions
      (external_id, provider, parent_external_id, title, repository, branch, status, started_at, updated_at)
      VALUES (?, 'codex', ?, ?, 'beacon', 'feature/beacon', 'completed', ?, ?)`);
    insert.run("cost-parent", null, "Parent run", now, now);
    insert.run("cost-child", "cost-parent", "Subagent run", now, now);
    const usage = sqlite.prepare(`INSERT INTO session_model_usage
      (session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reported_cost_usd)
      SELECT id, 'gpt-5', 0, 0, 0, 0, ? FROM sessions WHERE external_id = ?`);
    usage.run(1, "cost-parent");
    usage.run(2, "cost-child");
    try {
      const detail = queries.getProjectDetail("beacon");
      expect(detail?.totalCostUsd).toBe(3);
      expect(detail?.unpricedSessionCount).toBe(0);
      // The subtree roll-up still credits the parent with both, so the
      // "most expensive session" ranking sees 3 while the total stays 3.
      expect(detail?.largestCostSession?.title).toBe("Parent run");
      expect(detail?.largestCostSession?.costUsd).toBe(3);
    } finally {
      sqlite
        .prepare(
          "DELETE FROM sessions WHERE external_id IN ('cost-parent', 'cost-child')",
        )
        .run();
    }
  });

  it("filters briefing evidence down to sessions needing attention", () => {
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO sessions
        (external_id, provider, title, repository, branch, status, status_reason, started_at, updated_at)
        VALUES (?, 'zcode', ?, 'relay', 'main', 'failed', 'model_error', ?, ?)`,
      )
      .run("project-failed", "Failed run", now, now);
    try {
      const all = queries.getProjectDetail("relay", "7d", "all");
      const attention = queries.getProjectDetail("relay", "7d", "attention");
      expect(attention?.sessions.map((session) => session.title)).toEqual([
        "Failed run",
      ]);
      expect(attention?.sessions.length).toBeLessThan(
        all?.sessions.length ?? 0,
      );
    } finally {
      sqlite
        .prepare("DELETE FROM sessions WHERE external_id = ?")
        .run("project-failed");
    }
  });

  it("derives waiting and blocked project states from actionable evidence", () => {
    const now = new Date().toISOString();
    const insert = sqlite.prepare(`INSERT INTO sessions
      (external_id, provider, title, repository, branch, status, started_at, updated_at)
      VALUES (?, 'zcode', ?, 'relay', 'main', ?, ?, ?)`);
    insert.run(
      "project-waiting",
      "Waiting for review",
      "needs_attention",
      now,
      now,
    );
    try {
      const waiting = queries.getProjectDetail("relay");
      expect(waiting?.state).toBe("waiting");
      expect(waiting?.attention.map((session) => session.title)).toContain(
        "Waiting for review",
      );
    } finally {
      sqlite
        .prepare("DELETE FROM sessions WHERE external_id = ?")
        .run("project-waiting");
    }
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

  it("keeps incomplete sessions out and includes the past three calendar days", () => {
    const now = new Date();
    const twoDaysAgo = new Date(now);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    twoDaysAgo.setHours(12, 0, 0, 0);
    const threeDaysAgo = new Date(now);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    threeDaysAgo.setHours(12, 0, 0, 0);
    sqlite
      .prepare(
        `INSERT INTO sessions
         (external_id, provider, title, status, started_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "waiting-approval",
        "zcode",
        "Waiting for approval",
        "needs_attention",
        new Date(now.getTime() - 3 * 24 * 60 * 60_000).toISOString(),
        twoDaysAgo.toISOString(),
        "old-attention",
        "zcode",
        "Old attention",
        "needs_attention",
        new Date(now.getTime() - 4 * 24 * 60 * 60_000).toISOString(),
        threeDaysAgo.toISOString(),
      );
    sqlite
      .prepare(
        `INSERT INTO sessions
         (external_id, provider, title, status, status_reason, started_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "failed-usage",
        "zcode",
        "Failed on usage limit",
        "failed",
        "usage_limit",
        new Date(now.getTime() - 3 * 24 * 60 * 60_000).toISOString(),
        twoDaysAgo.toISOString(),
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
          ["interrupted", "needs_attention", "failed"].includes(session.status),
        ),
      ).toBe(true);
      expect(attention.map((session) => session.title)).toContain(
        "Waiting for approval",
      );
      const failed = attention.find(
        (session) => session.title === "Failed on usage limit",
      );
      expect(failed?.status).toBe("failed");
      expect(failed?.statusReason).toBe("usage_limit");
      expect(attention.map((session) => session.title)).not.toContain(
        "Old attention",
      );
    } finally {
      sqlite
        .prepare("DELETE FROM sessions WHERE external_id IN (?, ?, ?)")
        .run("waiting-approval", "old-attention", "failed-usage");
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
  it("builds a day-by-time heatmap covering the actual last 30 days", () => {
    const patterns = queries.getOverviewPatterns("30d");
    // One cell per 3-hour band per actual calendar day, day-major.
    expect(patterns.heatmap).toHaveLength(30 * 8);
    for (const cell of patterns.heatmap) {
      expect(cell.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(cell.band).toBeGreaterThanOrEqual(0);
      expect(cell.band).toBeLessThan(8);
    }
    const days = [...new Set(patterns.heatmap.map((cell) => cell.day))];
    expect([...days].sort()).toEqual(days);
    expect(days).toHaveLength(30);
    // Each day's 8 bands are consecutive and in order.
    expect(patterns.heatmap.slice(0, 8).map((cell) => cell.band)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    // Three sessions started within the 30-day window: one today, two at
    // the same instant two days ago (same day, same band).
    const total = patterns.heatmap.reduce((sum, cell) => sum + cell.count, 0);
    expect(total).toBe(3);
    expect(patterns.heatmap.filter((cell) => cell.count > 0)).toHaveLength(2);
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
    // Two hours from now, UTC may already be tomorrow while Eastern time is
    // still today. Whatever instant we pick inside the window, the session
    // must land on its Eastern-time calendar day.
    const instant = "2026-07-14T00:30:00.000Z"; // Monday 20:30 EDT
    const easternDay = "2026-07-13";
    const easternBand = 6; // 20:30 falls in the 6–9 PM band
    const before = queries.getOverviewPatterns("30d");
    const beforeCount =
      before.heatmap.find(
        (cell) => cell.day === easternDay && cell.band === easternBand,
      )?.count ?? 0;
    sqlite
      .prepare(
        `INSERT INTO sessions (external_id, provider, title, status, started_at, updated_at)
         VALUES ('heat-eastern', 'codex', 'Heatmap placement check', 'completed', ?, ?)`,
      )
      .run(instant, instant);
    try {
      const patterns = queries.getOverviewPatterns("30d");
      const easternCell = patterns.heatmap.find(
        (cell) => cell.day === easternDay && cell.band === easternBand,
      );
      expect(easternCell?.count).toBe(beforeCount + 1);
    } finally {
      sqlite
        .prepare("DELETE FROM sessions WHERE external_id = 'heat-eastern'")
        .run();
    }
  });

  it("narrows the heatmap and windows to 7 days and widens them to 30", () => {
    // A session started ~10 days ago is outside the 7-day window but inside 30.
    const now = new Date();
    const instant = new Date(
      now.getTime() - 10 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const baselineWeek = queries.getOverview("7d").week.sessions;
    const baselineMonth = queries.getOverview("30d").week.sessions;
    sqlite
      .prepare(
        `INSERT INTO sessions (external_id, provider, title, status, started_at, updated_at)
         VALUES ('range-span', 'codex', 'Range span check', 'completed', ?, ?)`,
      )
      .run(instant, instant);
    try {
      // overview week window: excluded at 7d, included at 30d.
      expect(queries.getOverview("7d").week.sessions).toBe(baselineWeek);
      expect(queries.getOverview("30d").week.sessions).toBe(baselineMonth + 1);
      // heatmap: always 30 days (30*8 cells) regardless of range, so the
      // 10-day-old session appears in the heatmap total at both ranges.
      const patterns7 = queries.getOverviewPatterns("7d");
      const patterns30 = queries.getOverviewPatterns("30d");
      expect(patterns7.heatmap).toHaveLength(30 * 8);
      expect(patterns30.heatmap).toHaveLength(30 * 8);
      const total7 = patterns7.heatmap.reduce(
        (sum, cell) => sum + cell.count,
        0,
      );
      const total30 = patterns30.heatmap.reduce(
        (sum, cell) => sum + cell.count,
        0,
      );
      expect(total30 - total7).toBe(0);
      // length histogram follows the range: the 7-day window excludes a
      // 10-day-old session's runtime, the 30-day window includes it.
      expect(patterns7.length.sessionCount).toBeLessThan(
        patterns30.length.sessionCount,
      );
    } finally {
      sqlite
        .prepare("DELETE FROM sessions WHERE external_id = 'range-span'")
        .run();
    }
  });
});
