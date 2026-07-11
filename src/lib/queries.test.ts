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
      activeNow: 0,
    });
  });
});
