import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let directory = "";
let sqlite: (typeof import("@/db/client"))["sqlite"];
let queries: typeof import("./queries");

const HOUR_MS = 60 * 60 * 1000;

beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "relay-cost-"));
  process.env.RELAY_DATABASE_PATH = path.join(directory, "relay.db");
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
  const usage = sqlite.prepare(`INSERT INTO session_model_usage
    (session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reported_cost_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  usage.run(1, "pi-model", 1000, 500, 0, 0, 1.25);
  usage.run(2, "mystery-model", 1000, 500, 0, 0, 2.5);
  usage.run(2, "unknown-unpriced-model", 1000, 500, 0, 0, null);
});

afterAll(async () => {
  sqlite.close();
  delete process.env.RELAY_DATABASE_PATH;
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
});

describe("getSessions sorting", () => {
  it("defaults to last updated with derived costUsd attached", () => {
    const sessions = queries.getSessions({});
    expect(sessions.map((session) => session.externalId)).toEqual([
      "cost-1",
      "cost-2",
      "cost-3",
    ]);
    expect(sessions[0].costUsd).toBe(1.25);
    expect(sessions[2].costUsd).toBeNull();
  });

  it("sorts by duration", () => {
    const sessions = queries.getSessions({ sort: "duration" });
    expect(sessions[0].externalId).toBe("cost-2");
  });

  it("sorts by cost with unpriced sessions last", () => {
    const sessions = queries.getSessions({ sort: "cost" });
    expect(sessions[0].externalId).toBe("cost-1");
    expect(sessions.at(-1)?.costUsd ?? null).toBeNull();
  });
});
