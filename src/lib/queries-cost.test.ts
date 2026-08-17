import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let directory = "";
let sqlite: (typeof import("@/db/client"))["sqlite"];
let queries: typeof import("./queries");

const HOUR_MS = 60 * 60 * 1000;

beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarium-cost-"));
  process.env.AGENTARIUM_DATABASE_PATH = path.join(directory, "agentarium.db");
  vi.resetModules();
  ({ sqlite } = await import("@/db/client"));
  queries = await import("./queries");
  const insert = sqlite.prepare(`INSERT INTO sessions
    (external_id, provider, title, repository, status, started_at, updated_at, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const now = Date.now();
  // Session 1: short, fully priced via reported cost.
  insert.run(
    "cost-1",
    "pi",
    "Priced short session",
    "relay",
    "completed",
    new Date(now - 1 * HOUR_MS).toISOString(),
    new Date(now - 0.9 * HOUR_MS).toISOString(),
    new Date(now - 0.9 * HOUR_MS).toISOString(),
  );
  // Session 2: long, has one priced and one unpriceable usage row.
  insert.run(
    "cost-2",
    "codex",
    "Partially priced long session",
    "relay",
    "completed",
    new Date(now - 10 * HOUR_MS).toISOString(),
    new Date(now - 2 * HOUR_MS).toISOString(),
    new Date(now - 2 * HOUR_MS).toISOString(),
  );
  // Session 3: no usage rows at all.
  insert.run(
    "cost-3",
    "codex",
    "No usage session",
    "relay",
    "completed",
    new Date(now - 3 * HOUR_MS).toISOString(),
    new Date(now - 2.5 * HOUR_MS).toISOString(),
    new Date(now - 2.5 * HOUR_MS).toISOString(),
  );
  // Sessions 4-6: a main session with a subagent that itself delegates once.
  const nested = sqlite.prepare(`INSERT INTO sessions
    (external_id, provider, parent_external_id, session_kind, agent_depth,
     title, repository, status, started_at, updated_at, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  nested.run(
    "tree-main",
    "claude",
    null,
    "main",
    0,
    "Main with subagents",
    "relay",
    "completed",
    new Date(now - 5 * HOUR_MS).toISOString(),
    new Date(now - 4 * HOUR_MS).toISOString(),
    new Date(now - 4 * HOUR_MS).toISOString(),
  );
  nested.run(
    "tree-child",
    "claude",
    "tree-main",
    "subagent",
    1,
    "Child subagent",
    "relay",
    "completed",
    new Date(now - 5 * HOUR_MS).toISOString(),
    new Date(now - 4.5 * HOUR_MS).toISOString(),
    new Date(now - 4.5 * HOUR_MS).toISOString(),
  );
  nested.run(
    "tree-grandchild",
    "claude",
    "tree-child",
    "subagent",
    2,
    "Grandchild subagent",
    "relay",
    "completed",
    new Date(now - 5 * HOUR_MS).toISOString(),
    new Date(now - 4.6 * HOUR_MS).toISOString(),
    new Date(now - 4.6 * HOUR_MS).toISOString(),
  );
  // Session 7: another provider reusing the same external id, to prove the
  // roll-up stays provider-scoped.
  insert.run(
    "tree-child",
    "codex",
    "Same id, different provider",
    "relay",
    "completed",
    new Date(now - 5 * HOUR_MS).toISOString(),
    new Date(now - 4 * HOUR_MS).toISOString(),
    new Date(now - 4 * HOUR_MS).toISOString(),
  );
  const usage = sqlite.prepare(`INSERT INTO session_model_usage
    (session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reported_cost_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  usage.run(1, "pi-model", 1000, 500, 0, 0, 1.25);
  usage.run(2, "mystery-model", 1000, 500, 0, 0, 2.5);
  usage.run(2, "unknown-unpriced-model", 1000, 500, 0, 0, null);
  usage.run(4, "pi-model", 1000, 500, 0, 0, 1);
  usage.run(5, "pi-model", 1000, 500, 0, 0, 2);
  usage.run(6, "pi-model", 1000, 500, 0, 0, 4);
  usage.run(7, "pi-model", 1000, 500, 0, 0, 8);
});

afterAll(async () => {
  sqlite.close();
  delete process.env.AGENTARIUM_DATABASE_PATH;
  await fs.rm(directory, { recursive: true, force: true });
});

describe("getSessionsCostUsd", () => {
  it("sums reported costs and follows the pricing-trust rule", () => {
    const costs = queries.getSessionsCostUsd([1, 2, 3]);
    expect(costs.get(1)).toBe(1.25);
    // One unpriceable row poisons the whole session.
    expect(costs.get(2)).toBeNull();
    // No usage rows: absent from the map.
    expect(costs.has(3)).toBe(false);
  });

  it("returns an empty map for no ids", () => {
    expect(queries.getSessionsCostUsd([]).size).toBe(0);
  });

  it("rolls subagent spend up into the session that delegated it", () => {
    const costs = queries.getSessionsCostUsd([4, 5, 6]);
    // main + child + grandchild
    expect(costs.get(4)).toBe(7);
    // child + grandchild, without the main session above it
    expect(costs.get(5)).toBe(6);
    expect(costs.get(6)).toBe(4);
  });

  it("keeps the roll-up scoped to the session's own provider", () => {
    // Session 7 shares "tree-child" with the Claude subagent but is a Codex
    // root: it must neither absorb nor be absorbed by that tree.
    expect(queries.getSessionsCostUsd([7]).get(7)).toBe(8);
    expect(queries.getSessionsCostUsd([4]).get(4)).toBe(7);
  });
});

describe("getSessionUsage", () => {
  it("splits own spend from the subagent roll-up", () => {
    const usage = queries.getSessionUsage(4);
    expect(usage.costUsd).toBe(1);
    expect(usage.subagentCostUsd).toBe(6);
    expect(usage.totalCostUsd).toBe(7);
    expect(usage.totalCostSource).toBe("reported");
    // models stays the session's own usage, not the subtree's.
    expect(usage.models).toHaveLength(1);
  });

  it("reports zero subagent spend for a session that delegated nothing", () => {
    const usage = queries.getSessionUsage(1);
    expect(usage.subagentCostUsd).toBe(0);
    expect(usage.totalCostUsd).toBe(1.25);
  });

  it("propagates an unpriced row to the total", () => {
    const usage = queries.getSessionUsage(2);
    expect(usage.totalCostUsd).toBeNull();
    expect(usage.totalCostSource).toBe("unavailable");
  });
});

describe("getSessions sorting", () => {
  it("defaults to last updated with derived costUsd attached", () => {
    const sessions = queries.getSessions({});
    // Subagents nest under their main session, so only roots are listed.
    expect(sessions.map((session) => session.externalId)).toEqual([
      "cost-1",
      "cost-2",
      "cost-3",
      "tree-main",
      "tree-child",
    ]);
    expect(sessions[0].costUsd).toBe(1.25);
    expect(sessions[2].costUsd).toBeNull();
    // Root row carries the whole subtree; the nested child carries its own.
    expect(sessions[3].costUsd).toBe(7);
    expect(sessions[3].children[0].costUsd).toBe(6);
  });

  it("sorts by duration", () => {
    const sessions = queries.getSessions({ sort: "duration" });
    expect(sessions[0].externalId).toBe("cost-2");
  });

  it("sorts by rolled-up cost with unpriced sessions last", () => {
    const sessions = queries.getSessions({ sort: "cost" });
    expect(sessions.map((session) => session.externalId)).toEqual([
      "tree-child", // codex root, $8
      "tree-main", // $1 own + $6 delegated beats cost-1's $1.25
      "cost-1",
      "cost-2",
      "cost-3",
    ]);
    expect(sessions.at(-1)?.costUsd ?? null).toBeNull();
  });
});

describe("getProjectsWithCosts", () => {
  it("sums each filtered session tree once and reports excluded unpriced trees", () => {
    const projects = queries.getProjectsWithCosts({ range: "all" });
    const tasks = projects.find((project) => project.key === "(tasks)");

    expect(tasks).toMatchObject({
      totalCostUsd: 16.25,
      unpricedSessionCount: 1,
    });
  });

  it("does not cap all-time project cost summaries at the session-table limit", () => {
    const insert = sqlite.prepare(`INSERT INTO sessions
      (external_id, provider, title, repository, branch, status, started_at, updated_at, ended_at)
      VALUES (?, 'codex', ?, ?, 'main', 'completed', ?, ?, ?)`);
    const usage = sqlite.prepare(`INSERT INTO session_model_usage
      (session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reported_cost_usd)
      VALUES (?, 'pi-model', 1000, 500, 0, 0, 3)`);
    const oldAt = new Date(Date.now() - 20 * HOUR_MS).toISOString();
    const old = insert.run(
      "uncapped-project-cost",
      "Older priced project session",
      "uncapped-project",
      oldAt,
      oldAt,
      oldAt,
    );
    usage.run(Number(old.lastInsertRowid));
    const insertFillers = sqlite.transaction(() => {
      for (let index = 0; index < 250; index += 1) {
        const at = new Date(Date.now() - index * 1000).toISOString();
        insert.run(
          `project-cost-filler-${index}`,
          `Newer filler ${index}`,
          "filler-project",
          at,
          at,
          at,
        );
      }
    });
    insertFillers();

    try {
      const project = queries
        .getProjectsWithCosts({ range: "all" })
        .find((candidate) => candidate.key === "uncapped-project");

      expect(project).toMatchObject({
        sessionCount: 1,
        totalCostUsd: 3,
        unpricedSessionCount: 0,
      });
    } finally {
      sqlite
        .prepare(
          "DELETE FROM sessions WHERE external_id = ? OR external_id LIKE 'project-cost-filler-%'",
        )
        .run("uncapped-project-cost");
    }
  });

  it("matches project briefing rollups when a priced subagent has an unpriced parent", () => {
    const now = Date.now();
    const insert = sqlite.prepare(`INSERT INTO sessions
      (external_id, provider, parent_external_id, session_kind, agent_depth,
       title, repository, branch, status, started_at, updated_at, ended_at)
      VALUES (?, 'codex', ?, ?, ?, ?, 'alignment', 'main', 'completed', ?, ?, ?)`);
    const parent = insert.run(
      "alignment-parent",
      null,
      "main",
      0,
      "Unpriced parent",
      new Date(now - 2 * HOUR_MS).toISOString(),
      new Date(now - 1 * HOUR_MS).toISOString(),
      new Date(now - 1 * HOUR_MS).toISOString(),
    );
    const child = insert.run(
      "alignment-child",
      "alignment-parent",
      "subagent",
      1,
      "Priced child",
      new Date(now - 1 * HOUR_MS).toISOString(),
      new Date(now - 0.5 * HOUR_MS).toISOString(),
      new Date(now - 0.5 * HOUR_MS).toISOString(),
    );
    const usage = sqlite.prepare(`INSERT INTO session_model_usage
      (session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reported_cost_usd)
      VALUES (?, ?, 1000, 500, 0, 0, ?)`);
    usage.run(Number(parent.lastInsertRowid), "unknown-unpriced-model", null);
    usage.run(Number(child.lastInsertRowid), "reported-model", 5);

    try {
      const table = queries
        .getProjectsWithCosts({ range: "all" })
        .find((project) => project.key === "alignment");
      const briefing = queries.getProjectDetail("alignment", "all");

      expect(table).toMatchObject({
        sessionCount: 2,
        totalRuntimeMs: 1.5 * HOUR_MS,
        totalCostUsd: 5,
        unpricedSessionCount: 1,
      });
      expect(table?.sessionCount).toBe(briefing?.windowSessionCount);
      expect(table?.totalRuntimeMs).toBeCloseTo(
        briefing?.windowRuntimeMs ?? 0,
        -1,
      );
      expect(table?.totalCostUsd).toBe(briefing?.totalCostUsd);
      expect(table?.unpricedSessionCount).toBe(briefing?.unpricedSessionCount);
    } finally {
      sqlite
        .prepare("DELETE FROM sessions WHERE repository = 'alignment'")
        .run();
    }
  });
});

describe("getUsageSummary ranges", () => {
  it("scopes totals, buckets, and daily history to all time", () => {
    const startedAt = new Date(Date.now() - 45 * 24 * HOUR_MS).toISOString();
    const result = sqlite
      .prepare(
        `INSERT INTO sessions
        (external_id, provider, title, repository, status, started_at, updated_at, ended_at)
        VALUES ('usage-all-time', 'zcode', 'Historical usage', 'archive', 'completed', ?, ?, ?)`,
      )
      .run(startedAt, startedAt, startedAt);
    sqlite
      .prepare(
        `INSERT INTO session_model_usage
        (session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reported_cost_usd)
        VALUES (?, 'historical-model', 100, 50, 25, 0, 2)`,
      )
      .run(Number(result.lastInsertRowid));

    try {
      const month = queries.getUsageSummary("30d");
      const all = queries.getUsageSummary("all");

      expect(all.selected.sessions).toBe(month.selected.sessions + 1);
      expect(all.selected.costUsd).toBeCloseTo(month.selected.costUsd + 2, 6);
      expect(all.byProvider.map((bucket) => bucket.key)).toContain("zcode");
      expect(month.byProvider.map((bucket) => bucket.key)).not.toContain(
        "zcode",
      );
      expect(all.daily[0]?.date).toBe(startedAt.slice(0, 10));
    } finally {
      sqlite
        .prepare("DELETE FROM sessions WHERE external_id = 'usage-all-time'")
        .run();
    }
  });
});
