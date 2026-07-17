import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let directory = "";
let sqlite: (typeof import("@/db/client"))["sqlite"];
let queries: typeof import("./queries");

beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "relay-insights-"));
  process.env.RELAY_DATABASE_PATH = path.join(directory, "relay.db");
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

  // Session 1: this week, 75% cache hit (cache_read 300 / (300 + 100 input)).
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
  insertUsage.run(1, "gpt-5.5", 100, 50, 300, 0, null);
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
});

afterAll(async () => {
  sqlite.close();
  delete process.env.RELAY_DATABASE_PATH;
  await fs.rm(directory, { recursive: true, force: true });
});

describe("getInsights — cache effectiveness", () => {
  it("computes a weighted hit rate across this week's tokens", () => {
    const { cache } = queries.getInsights();
    // This week: s1 read=300 in=100; s2 read=0 in=400; s4 read=100 in=100.
    // Weighted hit = (300 + 0 + 100) / (400 + 400 + 200) = 400/1000 = 0.4
    expect(cache.week.hitRate).toBeCloseTo(0.4, 5);
  });

  it("returns a by-model hit-rate breakdown", () => {
    const { cache } = queries.getInsights();
    const gpt = cache.week.byModel.find((m) => m.model === "gpt-5.5");
    expect(gpt).toBeDefined();
    // gpt-5.5 this week (s1 read=300 in=100, s2 read=0 in=400): 300/800 -> 0.375
    expect(gpt!.hitRate).toBeCloseTo(0.375, 5);
    expect(gpt!.tokens).toBe(900); // input+output+cacheRead+cacheWrite across s1+s2
  });

  it("reports $ saved as null when any this-week row is unpriced", () => {
    const { cache } = queries.getInsights();
    expect(cache.week.savedUsd).toBeNull();
    expect(cache.week.savedSharePct).toBeNull();
  });

  it("computes a week-over-week hit-rate delta in points", () => {
    const { cache } = queries.getInsights();
    // Prior week: s3 read=990 in=10 -> 0.99. This week: 0.4. Delta = -59 pts.
    expect(cache.week.hitRateDeltaPts).not.toBeNull();
    expect(cache.week.hitRateDeltaPts!).toBeCloseTo(-59, 0);
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
    insertSession.run(
      "s5",
      "codex",
      "Big spend",
      "gpt-5.5",
      "completed",
      iso(0),
      iso(0),
      iso(0),
    );
    insertUsage.run(5, "gpt-5.5", 2_000_000, 200_000, 0, 0, 1.0); // reported $1.00
    insertSession.run(
      "s6",
      "codex",
      "Small spend",
      "gpt-5.5",
      "completed",
      iso(0),
      iso(0),
      iso(0),
    );
    insertUsage.run(6, "gpt-5.5", 20_000, 0, 0, 0, 0.01); // reported $0.01
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
});
