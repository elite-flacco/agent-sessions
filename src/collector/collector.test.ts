import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProviderAdapter } from "@/lib/types";

let directory = "";
let sqlite: (typeof import("@/db/client"))["sqlite"];
let collector: typeof import("./index");
let lock: typeof import("./lock");
let claudeAdapter: ProviderAdapter;

beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "relay-collector-"));
  process.env.RELAY_DATABASE_PATH = path.join(directory, "relay.db");
  process.env.CODEX_STATE_DB_PATH = path.join(directory, "missing-codex.db");
  vi.resetModules();
  ({ sqlite } = await import("@/db/client"));
  collector = await import("./index");
  lock = await import("./lock");
  ({ claudeAdapter } = await import("./adapters/claude"));
});

afterAll(async () => {
  sqlite.close();
  delete process.env.RELAY_DATABASE_PATH;
  delete process.env.CODEX_STATE_DB_PATH;
  await fs.rm(directory, { recursive: true, force: true });
});

function claudeRow(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    type: "user",
    sessionId: "watched-1",
    timestamp: "2026-07-11T10:00:00Z",
    cwd: "/work/relay",
    message: { role: "user", content: "Watch this session" },
    ...overrides,
  });
}

async function until(
  condition: () => boolean,
  timeoutMs = 8_000,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs)
      throw new Error("Condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function sessionCount(externalId: string): number {
  return (
    sqlite
      .prepare("SELECT COUNT(*) count FROM sessions WHERE external_id = ?")
      .get(externalId) as { count: number }
  ).count;
}

describe("collector sync", () => {
  it("shares one run across concurrent sync requests and re-imports without duplicates", async () => {
    const filePath = path.join(directory, "concurrent.jsonl");
    await fs.writeFile(
      filePath,
      claudeRow({ sessionId: "concurrent-1", uuid: "u1" }),
    );
    let parses = 0;
    const adapter: ProviderAdapter = {
      provider: "claude",
      discover: async () => [filePath],
      parse: (target) => {
        parses += 1;
        return claudeAdapter.parse(target);
      },
    };
    const [first, second] = await Promise.all([
      collector.syncAll({ adapters: [adapter] }),
      collector.syncAll({ adapters: [adapter] }),
    ]);
    expect(first).toBe(second);
    expect(parses).toBe(1);
    expect(first.imported).toBe(1);
    expect(sessionCount("concurrent-1")).toBe(1);

    const unchanged = await collector.syncAll({ adapters: [adapter] });
    expect(unchanged).toMatchObject({ imported: 0, skipped: 1 });

    await fs.appendFile(
      filePath,
      `\n${claudeRow({ sessionId: "concurrent-1", uuid: "u2", type: "result", timestamp: "2026-07-11T10:05:00Z" })}`,
    );
    const reimported = await collector.syncAll({ adapters: [adapter] });
    expect(reimported.imported).toBe(1);
    expect(sessionCount("concurrent-1")).toBe(1);
    expect(
      (
        sqlite
          .prepare("SELECT status FROM sessions WHERE external_id = ?")
          .get("concurrent-1") as { status: string }
      ).status,
    ).toBe("completed");
  });

  it("skips scanning while another process holds the sync lease", async () => {
    expect(lock.acquireLease("sync", 60_000, "other-process")).toBe(true);
    const result = await collector.syncAll({ adapters: [] });
    expect(result.locked).toBe(true);
    lock.releaseLease("sync", "other-process");
    const unlocked = await collector.syncAll({ adapters: [] });
    expect(unlocked.locked).toBe(false);
  });

  it("takes over an expired lease from a dead process", async () => {
    sqlite
      .prepare(
        "INSERT OR REPLACE INTO collector_leases (name, owner, acquired_at, expires_at) VALUES ('sync', 'dead', ?, ?)",
      )
      .run(
        new Date(Date.now() - 120_000).toISOString(),
        new Date(Date.now() - 60_000).toISOString(),
      );
    const result = await collector.syncAll({ adapters: [] });
    expect(result.locked).toBe(false);
  });

  it("records per-adapter scan state", async () => {
    const scan = sqlite
      .prepare("SELECT * FROM adapter_scans WHERE provider = 'claude'")
      .get() as { sources: number } | undefined;
    expect(scan).toBeDefined();
    expect(scan?.sources).toBeGreaterThanOrEqual(1);
  });

  it("clears sync errors once a source parses cleanly again", async () => {
    const filePath = path.join(directory, "recovers.jsonl");
    await fs.writeFile(filePath, "not json at all");
    const adapter: ProviderAdapter = {
      ...claudeAdapter,
      discover: async () => [filePath],
    };
    await collector.syncAll({ adapters: [adapter] });
    const failed = sqlite
      .prepare("SELECT COUNT(*) count FROM sync_errors WHERE source_path = ?")
      .get(filePath) as { count: number };
    expect(failed.count).toBe(1);

    await fs.writeFile(
      filePath,
      claudeRow({ sessionId: "recovered-1", uuid: "u1" }),
    );
    await collector.syncAll({ adapters: [adapter] });
    const recovered = sqlite
      .prepare("SELECT COUNT(*) count FROM sync_errors WHERE source_path = ?")
      .get(filePath) as { count: number };
    expect(recovered.count).toBe(0);
    expect(sessionCount("recovered-1")).toBe(1);
  });

  it("refreshes metadata for Zcode sessions whose JSONL source is gone", async () => {
    const zcodeDbPath = path.join(directory, "zcode.db");
    const Database = (await import("better-sqlite3")).default;
    const zcodeDb = new Database(zcodeDbPath);
    zcodeDb.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY, directory TEXT NOT NULL, title TEXT NOT NULL,
        parent_id TEXT, task_type TEXT NOT NULL, title_source TEXT NOT NULL,
        time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, data TEXT NOT NULL
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL, data TEXT NOT NULL
      );
    `);
    const insertZcode = zcodeDb.prepare(
      `INSERT INTO session
       (id, directory, title, parent_id, task_type, title_source, time_created, time_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertZcode.run(
      "zcode-orphan",
      "/work/zcode-project",
      "Repair stored titles",
      null,
      "interactive",
      "generated",
      1_750_000_000_000,
      1_750_000_001_000,
    );
    insertZcode.run(
      "zcode-child",
      "/work/zcode-project",
      "Inspect the child task",
      "zcode-orphan",
      "subagent_child",
      "first_input",
      1_750_000_000_100,
      1_750_000_000_900,
    );
    zcodeDb.close();
    sqlite
      .prepare(
        `INSERT INTO sessions
         (external_id, provider, title, status, started_at, updated_at)
         VALUES (?, 'zcode', 'Zcode coding session', 'completed', ?, ?)`,
      )
      .run("zcode-orphan", "2026-07-11T10:00:00Z", "2026-07-11T10:01:00Z");
    process.env.ZCODE_DB_PATH = zcodeDbPath;
    const { __resetZcodeDbCache } = await import("@/lib/zcode-db");
    __resetZcodeDbCache();
    try {
      await collector.syncAll({ adapters: [] });
      expect(
        sqlite
          .prepare(
            "SELECT title, repository, cwd FROM sessions WHERE external_id = ?",
          )
          .get("zcode-orphan"),
      ).toEqual({
        title: "Repair stored titles",
        repository: "zcode-project",
        cwd: "/work/zcode-project",
      });
      expect(
        sqlite
          .prepare(
            "SELECT parent_external_id parentExternalId, session_kind sessionKind FROM sessions WHERE external_id = ?",
          )
          .get("zcode-child"),
      ).toEqual({
        parentExternalId: "zcode-orphan",
        sessionKind: "subagent",
      });
    } finally {
      delete process.env.ZCODE_DB_PATH;
      __resetZcodeDbCache();
    }
  });

  it("reconciles a Zcode session waiting for user input as needs attention", async () => {
    const zcodeDbPath = path.join(directory, "zcode-waiting.db");
    const Database = (await import("better-sqlite3")).default;
    const zcodeDb = new Database(zcodeDbPath);
    zcodeDb.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY, directory TEXT NOT NULL, title TEXT NOT NULL,
        parent_id TEXT, task_type TEXT NOT NULL, title_source TEXT NOT NULL,
        time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, data TEXT NOT NULL
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL, data TEXT NOT NULL
      );
    `);
    const startedAt = Date.now() - 60 * 60_000;
    const updatedAt = Date.now() - 30 * 60_000;
    zcodeDb
      .prepare(
        `INSERT INTO session
         (id, directory, title, parent_id, task_type, title_source, time_created, time_updated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "zcode-waiting",
        "/work/zcode-project",
        "Waiting for a decision",
        null,
        "interactive",
        "generated",
        startedAt,
        updatedAt,
      );
    zcodeDb
      .prepare(
        "INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
      )
      .run(
        "assistant-1",
        "zcode-waiting",
        updatedAt - 1_000,
        JSON.stringify({
          role: "assistant",
          time: { completed: updatedAt - 1_000 },
        }),
      );
    zcodeDb
      .prepare(
        "INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        "question-1",
        "assistant-1",
        "zcode-waiting",
        updatedAt,
        JSON.stringify({
          type: "tool",
          tool: "AskUserQuestion",
          state: { status: "running" },
        }),
      );
    zcodeDb.close();
    sqlite
      .prepare(
        `INSERT INTO sessions
         (external_id, provider, title, status, started_at, updated_at, ended_at)
         VALUES (?, 'zcode', ?, 'completed', ?, ?, ?)`,
      )
      .run(
        "zcode-waiting",
        "Waiting for a decision",
        new Date(startedAt).toISOString(),
        new Date(updatedAt - 1_000).toISOString(),
        new Date(updatedAt - 1_000).toISOString(),
      );
    process.env.ZCODE_DB_PATH = zcodeDbPath;
    const { __resetZcodeDbCache } = await import("@/lib/zcode-db");
    __resetZcodeDbCache();
    try {
      await collector.syncAll({ adapters: [] });
      expect(
        sqlite
          .prepare(
            "SELECT status FROM sessions WHERE external_id = 'zcode-waiting'",
          )
          .get(),
      ).toEqual({ status: "needs_attention" });
    } finally {
      delete process.env.ZCODE_DB_PATH;
      __resetZcodeDbCache();
    }
  });

  it("refreshes Codex titles when the app database changes without a JSONL change", async () => {
    const codexDbPath = path.join(directory, "codex-state.db");
    const Database = (await import("better-sqlite3")).default;
    const codexDb = new Database(codexDbPath);
    codexDb.exec(
      "CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT NOT NULL)",
    );
    codexDb
      .prepare("INSERT INTO threads (id, title) VALUES (?, ?)")
      .run("codex-renamed", "Renamed in Codex");
    codexDb.close();
    sqlite
      .prepare(
        `INSERT INTO sessions
         (external_id, provider, title, status, started_at, updated_at)
         VALUES (?, 'codex', 'Original user request', 'completed', ?, ?)`,
      )
      .run("codex-renamed", "2026-07-11T10:00:00Z", "2026-07-11T10:01:00Z");

    process.env.CODEX_STATE_DB_PATH = codexDbPath;
    const { __resetCodexDbCache } = await import("@/lib/codex-db");
    __resetCodexDbCache();
    try {
      await collector.syncAll({ adapters: [] });
      expect(
        sqlite
          .prepare(
            "SELECT title FROM sessions WHERE provider = 'codex' AND external_id = ?",
          )
          .get("codex-renamed"),
      ).toEqual({ title: "Renamed in Codex" });
    } finally {
      process.env.CODEX_STATE_DB_PATH = path.join(
        directory,
        "missing-codex.db",
      );
      __resetCodexDbCache();
    }
  });
});

describe("collector watcher", () => {
  it("ingests newly created and appended session files", async () => {
    const root = path.join(directory, "watched");
    await fs.mkdir(root, { recursive: true });
    const close = await collector.watchSources([
      { path: root, provider: "claude" },
    ]);
    try {
      const filePath = path.join(root, "watched-session.jsonl");
      await fs.writeFile(filePath, claudeRow({ uuid: "u1" }));
      await until(() => sessionCount("watched-1") === 1);

      await fs.appendFile(
        filePath,
        `\n${claudeRow({ uuid: "u2", type: "result", timestamp: "2026-07-11T10:09:00Z" })}`,
      );
      await until(
        () =>
          (
            sqlite
              .prepare("SELECT status FROM sessions WHERE external_id = ?")
              .get("watched-1") as { status: string } | undefined
          )?.status === "completed",
      );
    } finally {
      await close();
    }
  }, 20_000);

  it("refuses to start while another live watcher holds the lease", async () => {
    expect(lock.acquireLease("watch", 60_000, "other-watcher")).toBe(true);
    await expect(collector.watchSources([])).rejects.toThrow(
      /already watching/,
    );
    lock.releaseLease("watch", "other-watcher");
  });
});
