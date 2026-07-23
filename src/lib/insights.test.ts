import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  AgentCapability,
  AgentInventory,
} from "@/lib/agent-inventory/types";
import type { AgentProvider } from "@/lib/types";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DAY_MS = 24 * 60 * 60_000;

let directory = "";
let sqlite: (typeof import("@/db/client"))["sqlite"];
let queries: typeof import("./queries");

function capability(
  provider: AgentProvider,
  kind: "skill" | "mcp",
  name: string,
  status: "enabled" | "installed" | "disabled" = "installed",
): AgentCapability {
  return {
    id: `${provider}:${kind}:${name}`,
    name,
    kind,
    status,
    packaging: "standalone",
    origin: "personal",
  };
}

const inventories: AgentInventory[] = [
  {
    provider: "codex",
    scope: "global",
    warnings: [],
    capabilities: [
      capability("codex", "skill", "frontend-rules", "enabled"),
      capability("codex", "skill", "review-code-changes"),
      capability("codex", "skill", "never-used"),
      capability("codex", "skill", "disabled-skill", "disabled"),
      capability("codex", "mcp", "github", "enabled"),
    ],
  },
  {
    provider: "claude",
    scope: "global",
    warnings: [],
    capabilities: [
      capability("claude", "skill", "frontend-rules"),
      capability("claude", "mcp", "github"),
    ],
  },
];

beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "relay-insights-"));
  process.env.RELAY_DATABASE_PATH = path.join(directory, "relay.db");
  process.env.ZCODE_DB_PATH = path.join(directory, "missing-zcode.db");
  vi.resetModules();
  ({ sqlite } = await import("@/db/client"));
  queries = await import("./queries");

  const now = new Date();
  const iso = (offsetMs: number) =>
    new Date(now.getTime() - offsetMs).toISOString();
  const insertSession = sqlite.prepare(`INSERT INTO sessions
    (external_id, provider, title, model, status, started_at, updated_at, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertUsage = sqlite.prepare(`INSERT INTO session_model_usage
    (session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reported_cost_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertScan = sqlite.prepare(`INSERT INTO adapter_scans
    (provider, last_scan_at, sources, imported, errors) VALUES (?, ?, ?, ?, ?)`);
  insertScan.run("codex", iso(0), 1, 1, 0);
  insertScan.run("claude", iso(0), 1, 1, 0);

  // Session 1: this week, 60% cache hit. Cache writes are misses, so the
  // denominator includes 100 uncached input, 100 cache writes, and 300 reads.
  // Priced via pricing table (gpt-5.5) so $-saved is computed.
  insertSession.run(
    "s1",
    "codex",
    "Cache-friendly run",
    "gpt-5.5",
    "completed",
    iso(0),
    iso(0),
    iso(0),
  );
  insertUsage.run(1, "gpt-5.5", 100, 50, 300, 100, null);
  // Session 2: this week, priced, 0% cache hit (no cache reads).
  insertSession.run(
    "s2",
    "codex",
    "Cold run",
    "gpt-5.5",
    "completed",
    iso(0),
    iso(0),
    iso(0),
  );
  insertUsage.run(2, "gpt-5.5", 400, 50, 0, 0, null);
  // Session 3: prior week, high cache hit — establishes a baseline the delta measures against.
  // 9 days ago = outside this-week window, inside prior-week window.
  insertSession.run(
    "s3",
    "codex",
    "Prior good cache",
    "gpt-5.5",
    "completed",
    iso(9 * 24 * 60 * 60_000),
    iso(9 * 24 * 60 * 60_000),
    iso(9 * 24 * 60 * 60_000),
  );
  insertUsage.run(3, "gpt-5.5", 10, 0, 990, 0, null);
  // Session 4: this week, unpriced model — forces $-saved to null but still counts toward hit rate.
  insertSession.run(
    "s4",
    "codex",
    "Unpriced run",
    "mystery-model",
    "completed",
    iso(0),
    iso(0),
    iso(0),
  );
  insertUsage.run(4, "mystery-model", 100, 0, 100, 0, null);

  const insertCapabilitySession = sqlite.prepare(`INSERT INTO sessions
    (external_id, provider, title, status, started_at, updated_at, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertCapabilityUsage =
    sqlite.prepare(`INSERT INTO session_capability_usage
    (session_id, external_id, provider, kind, capability_name, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const insertCapability = (
    sessionId: number,
    externalId: string,
    provider: AgentProvider,
    kind: "skill" | "mcp",
    name: string,
    occurredAt: string,
  ) =>
    insertCapabilityUsage.run(
      sessionId,
      externalId,
      provider,
      kind,
      name,
      occurredAt,
    );

  const twoDaysAgo = iso(2 * DAY_MS);
  const tenDaysAgo = iso(10 * DAY_MS);
  const fortyDaysAgo = iso(40 * DAY_MS);
  const codexRecentId = Number(
    insertCapabilitySession.run(
      "cap-codex-recent",
      "codex",
      "Recent Codex capabilities",
      "completed",
      twoDaysAgo,
      twoDaysAgo,
      twoDaysAgo,
    ).lastInsertRowid,
  );
  const claudeOlderId = Number(
    insertCapabilitySession.run(
      "cap-claude-older",
      "claude",
      "Older Claude capabilities",
      "completed",
      tenDaysAgo,
      tenDaysAgo,
      tenDaysAgo,
    ).lastInsertRowid,
  );
  const codexHistoricalId = Number(
    insertCapabilitySession.run(
      "cap-codex-historical",
      "codex",
      "Historical Codex capabilities",
      "completed",
      fortyDaysAgo,
      fortyDaysAgo,
      fortyDaysAgo,
    ).lastInsertRowid,
  );

  insertCapability(
    codexRecentId,
    "cap-frontend-codex",
    "codex",
    "skill",
    "frontend-rules",
    twoDaysAgo,
  );
  insertCapability(
    claudeOlderId,
    "cap-frontend-claude",
    "claude",
    "skill",
    " Frontend-Rules ",
    tenDaysAgo,
  );
  insertCapability(
    codexHistoricalId,
    "cap-review-codex",
    "codex",
    "skill",
    "review-code-changes",
    fortyDaysAgo,
  );
  insertCapability(
    codexRecentId,
    "cap-github-codex-1",
    "codex",
    "mcp",
    "github",
    twoDaysAgo,
  );
  insertCapability(
    codexRecentId,
    "cap-github-codex-2",
    "codex",
    "mcp",
    "github",
    twoDaysAgo,
  );
  insertCapability(
    claudeOlderId,
    "cap-github-claude",
    "claude",
    "mcp",
    "github",
    tenDaysAgo,
  );
  insertCapability(
    claudeOlderId,
    "cap-shared-claude",
    "claude",
    "skill",
    "Shared-Skill",
    tenDaysAgo,
  );
  for (const name of ["rank-a", "rank-b", "rank-c", "retired-skill"]) {
    insertCapability(
      codexRecentId,
      `cap-${name}`,
      "codex",
      "skill",
      name,
      twoDaysAgo,
    );
  }
});

afterAll(async () => {
  sqlite.close();
  delete process.env.RELAY_DATABASE_PATH;
  delete process.env.ZCODE_DB_PATH;
  await fs.rm(directory, { recursive: true, force: true });
});

describe("getInsights — capability usage", () => {
  it("parses supported capability ranges and defaults invalid values", () => {
    expect(queries.parseCapabilityRange(undefined)).toBe("30d");
    expect(queries.parseCapabilityRange("7d")).toBe("7d");
    expect(queries.parseCapabilityRange("all")).toBe("30d");
  });

  it("ranks canonical capability usage and derives unused installations", () => {
    const capabilities = queries.getInsights("30d", inventories).capabilities;

    expect(capabilities.range).toBe("30d");
    expect(
      capabilities.mostUsed.filter((item) => item.kind === "skill")[0],
    ).toMatchObject({
      name: "frontend-rules",
      invocations: 2,
      sessionCount: 2,
      providers: ["codex", "claude"],
    });
    expect(capabilities.unused).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "review-code-changes",
          neverObserved: false,
        }),
        expect.objectContaining({ name: "never-used", neverObserved: true }),
      ]),
    );
    expect(capabilities.unused.map((item) => item.name)).not.toContain(
      "disabled-skill",
    );
  });

  it("excludes observations older than the selected range", () => {
    const capabilities = queries.getInsights("7d", inventories).capabilities;
    const frontend = capabilities.mostUsed.find(
      (item) => item.kind === "skill" && item.name === "frontend-rules",
    );

    expect(frontend).toMatchObject({
      invocations: 1,
      sessionCount: 1,
      providers: ["codex"],
    });
  });

  it("retains only the top five per kind with deterministic tie ordering", () => {
    const skills = queries
      .getInsights("30d", inventories)
      .capabilities.mostUsed.filter((item) => item.kind === "skill");

    expect(skills.map((item) => item.name)).toEqual([
      "frontend-rules",
      "rank-a",
      "rank-b",
      "rank-c",
      "retired-skill",
    ]);
    expect(skills).toHaveLength(5);
  });

  it("ranks ties by invocations, sessions, recency, then name", () => {
    const insertSession = sqlite.prepare(`INSERT INTO sessions
      (external_id, provider, title, status, started_at, updated_at, ended_at)
      VALUES (?, 'codex', ?, 'completed', ?, ?, ?)`);
    const insertUsage = sqlite.prepare(`INSERT INTO session_capability_usage
      (session_id, external_id, provider, kind, capability_name, occurred_at)
      VALUES (?, ?, 'codex', 'skill', ?, ?)`);
    const sessionIds: number[] = [];
    const now = Date.now();
    const older = new Date(now - 2 * DAY_MS).toISOString();
    const newer = new Date(now - DAY_MS).toISOString();
    const addSession = (suffix: string, occurredAt: string): number => {
      const id = Number(
        insertSession.run(
          `ranking-${suffix}`,
          `Ranking ${suffix}`,
          occurredAt,
          occurredAt,
          occurredAt,
        ).lastInsertRowid,
      );
      sessionIds.push(id);
      return id;
    };
    const addUses = (
      sessionId: number,
      name: string,
      count: number,
      occurredAt: string,
    ) => {
      for (let index = 0; index < count; index += 1) {
        insertUsage.run(
          sessionId,
          `${name}-${sessionId}-${index}`,
          name,
          occurredAt,
        );
      }
    };

    try {
      addUses(addSession("invocations", older), "tie-invocations", 6, older);
      addUses(addSession("sessions-a", older), "tie-sessions", 3, older);
      addUses(addSession("sessions-b", older), "tie-sessions", 2, older);
      addUses(addSession("newer", newer), "tie-newer", 5, newer);
      const sameTimeSession = addSession("same-time", older);
      addUses(sameTimeSession, "tie-alpha", 5, older);
      addUses(sameTimeSession, "tie-zeta", 5, older);

      const skills = queries
        .getInsights("30d", inventories)
        .capabilities.mostUsed.filter((item) => item.kind === "skill");

      expect(skills.map((item) => item.name)).toEqual([
        "tie-invocations",
        "tie-sessions",
        "tie-newer",
        "tie-alpha",
        "tie-zeta",
      ]);
    } finally {
      const placeholders = sessionIds.map(() => "?").join(", ");
      sqlite
        .prepare(`DELETE FROM sessions WHERE id IN (${placeholders})`)
        .run(...sessionIds);
    }
  });

  it("keeps only the top five MCP names when more than five are observed", () => {
    const occurredAt = new Date(Date.now() - DAY_MS).toISOString();
    const sessionId = Number(
      sqlite
        .prepare(
          `INSERT INTO sessions
          (external_id, provider, title, status, started_at, updated_at, ended_at)
          VALUES ('mcp-ranking', 'codex', 'MCP ranking', 'completed', ?, ?, ?)`,
        )
        .run(occurredAt, occurredAt, occurredAt).lastInsertRowid,
    );
    const insertUsage = sqlite.prepare(`INSERT INTO session_capability_usage
      (session_id, external_id, provider, kind, capability_name, occurred_at)
      VALUES (?, ?, 'codex', 'mcp', ?, ?)`);

    try {
      for (const [name, count] of [
        ["mcp-rank-a", 10],
        ["mcp-rank-b", 9],
        ["mcp-rank-c", 8],
        ["mcp-rank-d", 7],
        ["mcp-rank-e", 6],
        ["mcp-rank-f", 5],
      ] as const) {
        for (let index = 0; index < count; index += 1) {
          insertUsage.run(sessionId, `${name}-${index}`, name, occurredAt);
        }
      }

      const mcps = queries
        .getInsights("30d", inventories)
        .capabilities.mostUsed.filter((item) => item.kind === "mcp");

      expect(mcps.map((item) => item.name)).toEqual([
        "mcp-rank-a",
        "mcp-rank-b",
        "mcp-rank-c",
        "mcp-rank-d",
        "mcp-rank-e",
      ]);
      expect(mcps).toHaveLength(5);
    } finally {
      sqlite.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
    }
  });

  it("ranks observed capabilities even when they are no longer installed", () => {
    const capabilities = queries.getInsights("30d", inventories).capabilities;

    expect(capabilities.mostUsed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "skill",
          name: "retired-skill",
          invocations: 1,
        }),
      ]),
    );
  });

  it("derives unused status independently for each provider installation", () => {
    const inventoriesWithSharedSkill = inventories.map((inventory) => ({
      ...inventory,
      capabilities: [
        ...inventory.capabilities,
        capability(inventory.provider, "skill", "shared-skill"),
      ],
    }));

    const shared = queries
      .getInsights("30d", inventoriesWithSharedSkill)
      .capabilities.unused.find((item) => item.name === "shared-skill");

    expect(shared).toMatchObject({
      providers: ["codex"],
      lastUsedAt: null,
      neverObserved: true,
    });
  });

  it("does not report unused capabilities for partially covered providers", () => {
    sqlite
      .prepare("UPDATE adapter_scans SET errors = 1 WHERE provider = 'codex'")
      .run();
    try {
      const capabilities = queries.getInsights("30d", inventories).capabilities;

      expect(capabilities.coverage).toContainEqual({
        provider: "codex",
        state: "partial",
      });
      expect(capabilities.unused.map((item) => item.name)).not.toContain(
        "never-used",
      );
      expect(
        capabilities.unused.map((item) => item.providers).flat(),
      ).not.toContain("codex");
    } finally {
      sqlite
        .prepare("UPDATE adapter_scans SET errors = 0 WHERE provider = 'codex'")
        .run();
    }
  });

  it("marks absent scans unavailable without inferring unused capabilities", () => {
    const piInventory: AgentInventory = {
      provider: "pi",
      scope: "global",
      warnings: [],
      capabilities: [capability("pi", "skill", "pi-never-used")],
    };
    const capabilities = queries.getInsights("30d", [piInventory]).capabilities;

    expect(capabilities.coverage).toContainEqual({
      provider: "pi",
      state: "unavailable",
    });
    expect(capabilities.unused).toEqual([]);
  });

  it("marks Zcode coverage partial when its authoritative database is missing", () => {
    sqlite
      .prepare(
        `INSERT INTO adapter_scans
        (provider, last_scan_at, sources, imported, errors)
        VALUES ('zcode', ?, 1, 1, 0)`,
      )
      .run(new Date().toISOString());
    try {
      const zcodeInventory: AgentInventory = {
        provider: "zcode",
        scope: "global",
        warnings: [],
        capabilities: [capability("zcode", "skill", "zcode-never-used")],
      };
      const capabilities = queries.getInsights("30d", [
        zcodeInventory,
      ]).capabilities;

      expect(capabilities.coverage).toContainEqual({
        provider: "zcode",
        state: "partial",
      });
      expect(capabilities.unused).toEqual([]);
    } finally {
      sqlite
        .prepare("DELETE FROM adapter_scans WHERE provider = 'zcode'")
        .run();
    }
  });
});

describe("getInsights — cache effectiveness", () => {
  it("treats cache writes as misses in the weekly cache hit rate", () => {
    const { cache } = queries.getInsights();
    // This week: s1 read=300, input=100, write=100; s2 read=0, input=400;
    // s4 read=100, input=100. Hit rate = 400 / (400 + 600 + 100) = 4/11.
    expect(cache.week.hitRate).toBeCloseTo(4 / 11, 5);
  });

  it("returns a by-model hit-rate breakdown", () => {
    const { cache } = queries.getInsights();
    const gpt = cache.week.byModel.find((m) => m.model === "gpt-5.5");
    expect(gpt).toBeDefined();
    // gpt-5.5 this week: 300 reads / (100 input + 100 writes + 300 reads + 400 input).
    expect(gpt!.hitRate).toBeCloseTo(1 / 3, 5);
    expect(gpt!.tokens).toBe(1_000); // input+output+cacheRead+cacheWrite across s1+s2
  });

  it("reports $ saved as null when any this-week row is unpriced", () => {
    const { cache } = queries.getInsights();
    expect(cache.week.savedUsd).toBeNull();
    expect(cache.week.savedSharePct).toBeNull();
  });

  it("computes a week-over-week hit-rate delta in points", () => {
    const { cache } = queries.getInsights();
    // Prior week: s3 read=990 in=10 -> 0.99. This week: 4/11. Delta = -63 pts.
    expect(cache.week.hitRateDeltaPts).not.toBeNull();
    expect(cache.week.hitRateDeltaPts!).toBeCloseTo(-63, 0);
  });

  it("fires a warning signal on a >=15pt hit-rate drop", () => {
    const { cache } = queries.getInsights();
    expect(cache.signal).not.toBeNull();
    expect(cache.signal!.tone).toBe("warning");
    expect(cache.signal!.text).toMatch(/dropped/i);
  });

  it("produces a 30-day daily trend series", () => {
    const { cache } = queries.getInsights();
    expect(cache.trend).toHaveLength(30);
    expect(cache.trend[0]).toHaveProperty("day");
    expect(
      cache.trend.every(
        (d) => typeof d.hitRate === "number" || d.hitRate === null,
      ),
    ).toBe(true);
  });
});

describe("getInsights — cost outliers", () => {
  beforeAll(() => {
    const now = new Date();
    const iso = (offsetMs: number) =>
      new Date(now.getTime() - offsetMs).toISOString();
    // s5, s6: this week, priced, so a total + Pareto share exist. Insert via
    // a fresh prepared statement (the ones in the top-level beforeAll are out
    // of scope here).
    const insertSession = sqlite.prepare(`INSERT INTO sessions
      (external_id, provider, title, model, status, started_at, updated_at, ended_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertUsage = sqlite.prepare(`INSERT INTO session_model_usage
      (session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reported_cost_usd)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const bigSpendId = Number(
      insertSession.run(
        "s5",
        "codex",
        "Big spend",
        "gpt-5.5",
        "completed",
        iso(0),
        iso(0),
        iso(0),
      ).lastInsertRowid,
    );
    insertUsage.run(bigSpendId, "gpt-5.5", 2_000_000, 200_000, 0, 0, 1.0); // reported $1.00
    const smallSpendId = Number(
      insertSession.run(
        "s6",
        "codex",
        "Small spend",
        "gpt-5.5",
        "completed",
        iso(0),
        iso(0),
        iso(0),
      ).lastInsertRowid,
    );
    insertUsage.run(smallSpendId, "gpt-5.5", 20_000, 0, 0, 0, 0.01); // reported $0.01
  });

  it("reports null week totals when any this-week session is unpriced", () => {
    // s4 (mystery-model) is unpriced and in this-week window.
    const { cost } = queries.getInsights();
    expect(cost.week.totalUsd).toBeNull();
    expect(cost.week.paretoSharePct).toBeNull();
  });

  it("lists cost outliers with $/min even when the week total is unpriced", () => {
    // Outliers are ranked by per-row cost; pricing-trust does not gate the
    // list (rows with a cost contribute, rows without are skipped).
    const { cost } = queries.getInsights();
    expect(cost.outliers.length).toBeGreaterThan(0);
    const big = cost.outliers.find((o) => o.title === "Big spend");
    expect(big).toBeDefined();
    expect(big!.costUsd).toBe(1.0);
    expect(big!.usdPerMin).toBeGreaterThanOrEqual(0);
  });

  it("exposes distinct top-5 (headline) and top-3 (signal) share fields", () => {
    const { cost } = queries.getInsights();
    // Both are null here because the shared fixture's unpriced s4 forces the
    // trust rule, but the fields must both exist as distinct values.
    expect(cost.week).toHaveProperty("top5SharePct");
    expect(cost.week).toHaveProperty("paretoSharePct");
    expect(cost.week.top5SharePct).toBeNull();
    expect(cost.week.paretoSharePct).toBeNull();
  });
});
