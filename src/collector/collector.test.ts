import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProviderAdapter } from "@/lib/types";

const getAgentInventories = vi.hoisted(() => vi.fn(async () => []));

vi.mock("@/lib/agent-inventory", async () => ({
  ...(await vi.importActual<typeof import("@/lib/agent-inventory")>(
    "@/lib/agent-inventory",
  )),
  getAgentInventories,
}));

let directory = "";
let sqlite: (typeof import("@/db/client"))["sqlite"];
let collector: typeof import("./index");
let lock: typeof import("./lock");
let claudeAdapter: ProviderAdapter;
const ZCODE_DB_GUARD = "/dev/null/nonexistent-zcode-db";

beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "relay-collector-"));
  process.env.RELAY_DATABASE_PATH = path.join(directory, "relay.db");
  process.env.CODEX_STATE_DB_PATH = path.join(directory, "missing-codex.db");
  process.env.ZCODE_DB_PATH = ZCODE_DB_GUARD;
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
  delete process.env.ZCODE_DB_PATH;
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
  it("replaces capability usage idempotently and cascades with its session", async () => {
    const filePath = path.join(directory, "capability-usage.jsonl");
    await fs.writeFile(filePath, "{}\n");
    let pass = 0;
    const adapter: ProviderAdapter = {
      provider: "claude",
      discover: async () => [filePath],
      parse: async () => {
        pass += 1;
        return {
          errors: [],
          sessions: [
            {
              externalId: "capability-session",
              provider: "claude",
              title: "Capability session",
              status: "completed",
              startedAt: "2026-07-22T10:00:00Z",
              endedAt: "2026-07-22T10:02:00Z",
              updatedAt: "2026-07-22T10:02:00Z",
              usage: [],
              events: [],
              capabilityUsage:
                pass === 1
                  ? [
                      {
                        externalId: "skill:1",
                        kind: "skill",
                        name: "frontend-rules",
                        occurredAt: "2026-07-22T10:01:00Z",
                      },
                      {
                        externalId: "mcp:1",
                        kind: "mcp",
                        name: "github",
                        occurredAt: "2026-07-22T10:01:30Z",
                      },
                    ]
                  : [
                      {
                        externalId: "mcp:1",
                        kind: "mcp",
                        name: "github",
                        occurredAt: "2026-07-22T10:01:30Z",
                      },
                    ],
            },
          ],
        };
      },
    };

    await collector.syncAll({ adapters: [adapter], force: true });
    await collector.syncAll({ adapters: [adapter], force: true });
    expect(
      (
        sqlite
          .prepare("SELECT COUNT(*) count FROM session_capability_usage")
          .get() as { count: number }
      ).count,
    ).toBe(1);

    sqlite
      .prepare("DELETE FROM sessions WHERE external_id = ?")
      .run("capability-session");
    expect(
      (
        sqlite
          .prepare("SELECT COUNT(*) count FROM session_capability_usage")
          .get() as { count: number }
      ).count,
    ).toBe(0);
  });

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

  it("refreshes metadata and capability usage for Zcode database-only sessions", async () => {
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
      CREATE TABLE tool_usage (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        tool_call_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL
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
    zcodeDb
      .prepare(
        `INSERT INTO message (id, session_id, time_created, data)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        "zcode-child-message",
        "zcode-child",
        1_750_000_000_500,
        JSON.stringify({ role: "assistant", time: { completed: 1 } }),
      );
    zcodeDb
      .prepare(
        `INSERT INTO part (id, message_id, session_id, time_created, data)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        "zcode-skill-part",
        "zcode-child-message",
        "zcode-child",
        1_750_000_000_600,
        JSON.stringify({
          type: "tool",
          tool: "Skill",
          state: {
            status: "completed",
            input: {
              skill: "systematic-debugging",
              args: "PRIVATE_SKILL_INPUT",
            },
            output: "PRIVATE_SKILL_OUTPUT",
          },
        }),
      );
    zcodeDb
      .prepare(
        `INSERT INTO tool_usage
         (id, session_id, tool_call_id, tool_name, status, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "zcode-tool-usage",
        "zcode-child",
        "zcode-mcp-call",
        "mcp__plugin_openai-developers_openaiDeveloperDocs__search_openai_docs",
        "completed",
        1_750_000_000_700,
      );
    zcodeDb.close();
    sqlite
      .prepare(
        `INSERT INTO sessions
         (external_id, provider, title, status, started_at, updated_at)
         VALUES (?, 'zcode', 'Zcode coding session', 'completed', ?, ?)`,
      )
      .run("zcode-orphan", "2026-07-11T10:00:00Z", "2026-07-11T10:01:00Z");
    sqlite
      .prepare(
        `INSERT INTO session_capability_usage
         (session_id, external_id, provider, kind, capability_name, occurred_at)
         SELECT id, 'skill:rollout-only', 'zcode', 'skill', 'frontend-rules', ?
         FROM sessions WHERE provider = 'zcode' AND external_id = ?`,
      )
      .run("2026-07-11T10:00:30Z", "zcode-orphan");
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
      const capabilityUsage = sqlite
        .prepare(
          `SELECT external_id externalId, provider, kind,
                  capability_name name, occurred_at occurredAt
           FROM session_capability_usage
           WHERE session_id = (
             SELECT id FROM sessions
             WHERE provider = 'zcode' AND external_id = ?
           )
           ORDER BY occurred_at, external_id`,
        )
        .all("zcode-child");
      expect(capabilityUsage).toEqual([
        {
          externalId: "skill:zcode-skill-part",
          provider: "zcode",
          kind: "skill",
          name: "systematic-debugging",
          occurredAt: new Date(1_750_000_000_600).toISOString(),
        },
        {
          externalId: "mcp:zcode-mcp-call",
          provider: "zcode",
          kind: "mcp",
          name: "plugin_openai-developers_openaideveloperdocs",
          occurredAt: new Date(1_750_000_000_700).toISOString(),
        },
      ]);
      expect(JSON.stringify(capabilityUsage)).not.toMatch(
        /PRIVATE_SKILL_INPUT|PRIVATE_SKILL_OUTPUT/,
      );
      expect(
        (
          sqlite
            .prepare(
              `SELECT COUNT(*) count FROM session_capability_usage
               WHERE session_id = (
                 SELECT id FROM sessions
                 WHERE provider = 'zcode' AND external_id = ?
               )`,
            )
            .get("zcode-orphan") as { count: number }
        ).count,
      ).toBe(0);
    } finally {
      process.env.ZCODE_DB_PATH = ZCODE_DB_GUARD;
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
    sqlite
      .prepare(
        `INSERT INTO session_capability_usage
         (session_id, external_id, provider, kind, capability_name, occurred_at)
         SELECT id, 'skill:rollout-only', 'zcode', 'skill', 'frontend-rules', ?
         FROM sessions WHERE provider = 'zcode' AND external_id = ?`,
      )
      .run(new Date(updatedAt - 2_000).toISOString(), "zcode-waiting");
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
      expect(
        sqlite
          .prepare(
            `SELECT external_id externalId, capability_name name
             FROM session_capability_usage
             WHERE session_id = (
               SELECT id FROM sessions
               WHERE provider = 'zcode' AND external_id = ?
             )`,
          )
          .get("zcode-waiting"),
      ).toEqual({
        externalId: "skill:rollout-only",
        name: "frontend-rules",
      });
    } finally {
      process.env.ZCODE_DB_PATH = ZCODE_DB_GUARD;
      __resetZcodeDbCache();
    }
  });

  it("classifies terminal Zcode errors into failed with a reason", async () => {
    const zcodeDbPath = path.join(directory, "zcode-errors.db");
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
    const cases: Array<{
      id: string;
      message: string;
      status: string;
      reason: string | null;
    }> = [
      {
        id: "z-usage",
        message: "[1308][Usage limit reached for 5 hour.]",
        status: "failed",
        reason: "usage_limit",
      },
      {
        id: "z-balance",
        message: "[1113][Insufficient balance or no resource package.]",
        status: "failed",
        reason: "insufficient_balance",
      },
      {
        id: "z-network",
        message: "Network connection failed for the provider request.",
        status: "failed",
        reason: "network_error",
      },
      {
        id: "z-model",
        message:
          "Model returned no text, no tool calls, and no usage before completing the turn.",
        status: "failed",
        reason: "model_error",
      },
      {
        id: "z-exec",
        message: "Turn execution failed",
        status: "failed",
        reason: "execution_error",
      },
      {
        id: "z-cancel",
        message: "Request cancelled by user",
        status: "interrupted",
        reason: null,
      },
    ];
    for (const item of cases) {
      zcodeDb
        .prepare(
          `INSERT INTO session
           (id, directory, title, parent_id, task_type, title_source, time_created, time_updated)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          item.id,
          "/work/zcode-project",
          item.id,
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
          `${item.id}-assistant`,
          item.id,
          updatedAt,
          JSON.stringify({
            role: "assistant",
            error: {
              name: "AiSdkModelAdapterError",
              data: { message: item.message },
            },
          }),
        );
      sqlite
        .prepare(
          `INSERT INTO sessions
           (external_id, provider, title, status, started_at, updated_at)
           VALUES (?, 'zcode', ?, 'completed', ?, ?)`,
        )
        .run(
          item.id,
          item.id,
          new Date(startedAt).toISOString(),
          new Date(updatedAt).toISOString(),
        );
    }
    zcodeDb.close();
    process.env.ZCODE_DB_PATH = zcodeDbPath;
    const { __resetZcodeDbCache } = await import("@/lib/zcode-db");
    __resetZcodeDbCache();
    try {
      await collector.syncAll({ adapters: [] });
      for (const item of cases) {
        expect(
          sqlite
            .prepare(
              "SELECT status, status_reason statusReason FROM sessions WHERE external_id = ?",
            )
            .get(item.id),
        ).toEqual({ status: item.status, statusReason: item.reason });
      }
    } finally {
      process.env.ZCODE_DB_PATH = ZCODE_DB_GUARD;
      __resetZcodeDbCache();
    }
  });

  it("keeps an active Zcode session running by advancing updated_at from the Zcode DB", async () => {
    const zcodeDbPath = path.join(directory, "zcode-running.db");
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
    const dbUpdatedAt = Date.now() - 60_000; // fresh activity, only in the DB
    zcodeDb
      .prepare(
        `INSERT INTO session
         (id, directory, title, parent_id, task_type, title_source, time_created, time_updated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "zcode-running",
        "/work/zcode-project",
        "Long build in flight",
        null,
        "interactive",
        "generated",
        startedAt,
        dbUpdatedAt,
      );
    const insertMessage = zcodeDb.prepare(
      "INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
    );
    insertMessage.run(
      "user-1",
      "zcode-running",
      startedAt,
      JSON.stringify({ role: "user", time: { created: startedAt } }),
    );
    // In-flight assistant turn: created but not completed, no error.
    insertMessage.run(
      "assistant-1",
      "zcode-running",
      dbUpdatedAt,
      JSON.stringify({ role: "assistant", time: { created: dbUpdatedAt } }),
    );
    zcodeDb.close();
    // Relay last synced the rollout JSONL 30 minutes ago, past the stale window.
    const staleRelayUpdatedAt = new Date(
      Date.now() - 30 * 60_000,
    ).toISOString();
    sqlite
      .prepare(
        `INSERT INTO sessions
         (external_id, provider, title, status, started_at, updated_at)
         VALUES (?, 'zcode', 'Long build in flight', 'running', ?, ?)`,
      )
      .run(
        "zcode-running",
        new Date(startedAt).toISOString(),
        staleRelayUpdatedAt,
      );
    process.env.ZCODE_DB_PATH = zcodeDbPath;
    const { __resetZcodeDbCache } = await import("@/lib/zcode-db");
    __resetZcodeDbCache();
    try {
      await collector.syncAll({ adapters: [] });
      const row = sqlite
        .prepare(
          "SELECT status, updated_at updatedAt FROM sessions WHERE external_id = 'zcode-running'",
        )
        .get() as { status: string; updatedAt: string };
      expect(row.status).toBe("running");
      expect(row.updatedAt).toBe(new Date(dbUpdatedAt).toISOString());
    } finally {
      process.env.ZCODE_DB_PATH = ZCODE_DB_GUARD;
      __resetZcodeDbCache();
    }
  });

  it("keeps a Zcode session running when the latest assistant turn is in flight", async () => {
    const zcodeDbPath = path.join(directory, "zcode-inflight.db");
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
    const priorTurnCompletedAt = Date.now() - 5 * 60_000;
    const inflightStartedAt = Date.now() - 30_000; // within the stale window
    zcodeDb
      .prepare(
        `INSERT INTO session
         (id, directory, title, parent_id, task_type, title_source, time_created, time_updated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "zcode-inflight",
        "/work/zcode-project",
        "Still typing",
        null,
        "interactive",
        "generated",
        startedAt,
        inflightStartedAt,
      );
    const insertMessage = zcodeDb.prepare(
      "INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
    );
    insertMessage.run(
      "user-1",
      "zcode-inflight",
      startedAt,
      JSON.stringify({ role: "user", time: { created: startedAt } }),
    );
    // A previously completed assistant turn — this used to satisfy the
    // "role === 'assistant' && time.completed" check while walking backward
    // past the in-flight turn below.
    insertMessage.run(
      "assistant-1",
      "zcode-inflight",
      priorTurnCompletedAt,
      JSON.stringify({
        role: "assistant",
        time: {
          created: priorTurnCompletedAt,
          completed: priorTurnCompletedAt,
        },
      }),
    );
    // The newest assistant message is still in flight: created but not completed.
    insertMessage.run(
      "assistant-2",
      "zcode-inflight",
      inflightStartedAt,
      JSON.stringify({
        role: "assistant",
        time: { created: inflightStartedAt },
      }),
    );
    zcodeDb.close();
    sqlite
      .prepare(
        `INSERT INTO sessions
         (external_id, provider, title, status, started_at, updated_at)
         VALUES (?, 'zcode', 'Still typing', 'running', ?, ?)`,
      )
      .run(
        "zcode-inflight",
        new Date(startedAt).toISOString(),
        new Date(inflightStartedAt).toISOString(),
      );
    process.env.ZCODE_DB_PATH = zcodeDbPath;
    const { __resetZcodeDbCache } = await import("@/lib/zcode-db");
    __resetZcodeDbCache();
    try {
      await collector.syncAll({ adapters: [] });
      expect(
        sqlite
          .prepare(
            "SELECT status FROM sessions WHERE external_id = 'zcode-inflight'",
          )
          .get(),
      ).toEqual({ status: "running" });
    } finally {
      process.env.ZCODE_DB_PATH = ZCODE_DB_GUARD;
      __resetZcodeDbCache();
    }
  });

  it("reconciles an explicitly cancelled Zcode request as interrupted", async () => {
    const zcodeDbPath = path.join(directory, "zcode-cancelled.db");
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
        "zcode-cancelled",
        "/work/zcode-project",
        "Cancelled mid-request",
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
        "zcode-cancelled",
        updatedAt,
        JSON.stringify({
          role: "assistant",
          time: { created: updatedAt, completed: updatedAt },
          error: {
            name: "AiSdkModelAdapterError",
            data: { message: "Model request was cancelled." },
          },
        }),
      );
    zcodeDb.close();
    sqlite
      .prepare(
        `INSERT INTO sessions
         (external_id, provider, title, status, started_at, updated_at)
         VALUES (?, 'zcode', 'Cancelled mid-request', 'running', ?, ?)`,
      )
      .run(
        "zcode-cancelled",
        new Date(startedAt).toISOString(),
        new Date(updatedAt).toISOString(),
      );
    process.env.ZCODE_DB_PATH = zcodeDbPath;
    const { __resetZcodeDbCache } = await import("@/lib/zcode-db");
    __resetZcodeDbCache();
    try {
      await collector.syncAll({ adapters: [] });
      expect(
        sqlite
          .prepare(
            "SELECT status FROM sessions WHERE external_id = 'zcode-cancelled'",
          )
          .get(),
      ).toEqual({ status: "interrupted" });
    } finally {
      process.env.ZCODE_DB_PATH = ZCODE_DB_GUARD;
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
  it("releases the watch lease and timer when inventory discovery rejects", async () => {
    const root = path.join(directory, "failed-watcher");
    await fs.mkdir(root, { recursive: true });
    getAgentInventories.mockRejectedValueOnce(
      new Error("Inventory discovery failed"),
    );
    vi.useFakeTimers();
    try {
      await expect(
        collector.watchSources([{ path: root, provider: "claude" }]),
      ).rejects.toThrow("Inventory discovery failed");
      expect(lock.acquireLease("watch", 60_000, "subsequent-watcher")).toBe(
        true,
      );
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      lock.releaseLease("watch", "subsequent-watcher");
      lock.releaseLease("watch");
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

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
