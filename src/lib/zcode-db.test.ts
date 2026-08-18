import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  __resetZcodeDbCache,
  getZcodeModelUsage,
  getZcodeSessionMetadataResult,
  isZcodeCapabilityDbAvailable,
  isZcodeDbAvailable,
  listZcodeAutomations,
} from "./zcode-db";

const MODEL_USAGE_SCHEMA = `
  CREATE TABLE model_usage (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, model_id TEXT,
    query_source TEXT, status TEXT, attempt_index INTEGER DEFAULT 0,
    retry_count INTEGER DEFAULT 0, input_tokens INTEGER, output_tokens INTEGER,
    cache_read_input_tokens INTEGER, cache_creation_input_tokens INTEGER
  );
`;

const temporaryDirectories: string[] = [];

async function zcodeFixture(
  schema: string,
  envVar: "ZCODE_DB_PATH" | "ZCODE_TASKS_DB_PATH" = "ZCODE_DB_PATH",
): Promise<string> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "agentarium-zcode-db-"),
  );
  temporaryDirectories.push(directory);
  const dbPath = path.join(directory, "zcode.db");
  const db = new Database(dbPath);
  if (schema) db.exec(schema);
  db.close();
  process.env[envVar] = dbPath;
  __resetZcodeDbCache();
  return dbPath;
}

afterEach(async () => {
  __resetZcodeDbCache();
  delete process.env.ZCODE_DB_PATH;
  delete process.env.ZCODE_TASKS_DB_PATH;
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("Zcode capability database health", () => {
  it("rejects an open database that lacks the authoritative session query", async () => {
    await zcodeFixture(`
      CREATE TABLE message (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL, data TEXT NOT NULL
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY, message_id TEXT NOT NULL,
        session_id TEXT NOT NULL, time_created INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE tool_usage (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
        tool_call_id TEXT NOT NULL, tool_name TEXT NOT NULL,
        started_at INTEGER NOT NULL
      );
    `);

    expect(isZcodeDbAvailable()).toBe(true);
    expect(isZcodeCapabilityDbAvailable()).toBe(false);
    expect(getZcodeSessionMetadataResult("missing")).toEqual({ ok: false });
  });

  it("accepts a database with every authoritative capability query", async () => {
    await zcodeFixture(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY, directory TEXT NOT NULL, title TEXT NOT NULL,
        parent_id TEXT, task_type TEXT NOT NULL, title_source TEXT NOT NULL,
        time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE tool_usage (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        tool_call_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        started_at INTEGER NOT NULL
      );
    `);

    expect(isZcodeCapabilityDbAvailable()).toBe(true);
    expect(getZcodeSessionMetadataResult("missing")).toEqual({
      ok: true,
      value: undefined,
    });
  });
});

describe("Zcode model usage", () => {
  async function seedUsage(
    rows: Array<
      [string, string | null, string, number, number, number, number]
    >,
  ): Promise<void> {
    const dbPath = await zcodeFixture(MODEL_USAGE_SCHEMA);
    const db = new Database(dbPath);
    const insert = db.prepare(`INSERT INTO model_usage
      (id, session_id, model_id, query_source, status, input_tokens,
       output_tokens, cache_read_input_tokens, cache_creation_input_tokens)
      VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?)`);
    rows.forEach((r, i) =>
      insert.run(`u${i}`, r[0], r[1], r[2], r[3], r[4], r[5], r[6]),
    );
    db.close();
    __resetZcodeDbCache();
  }

  it("sums all query sources and derives uncached input", async () => {
    await seedUsage([
      // [session, model, query_source, input(cache-incl), output, cacheRead, cacheWrite]
      ["s1", "GLM-5.2", "main_turn", 8649, 43, 5376, 0],
      ["s1", "GLM-5.2", "session_title", 123, 11, 64, 0],
      ["s1", "GLM-5.2", "compact", 100, 0, 0, 0],
    ]);
    const usage = getZcodeModelUsage(["s1"]);
    expect(usage?.get("s1")).toEqual([
      {
        model: "GLM-5.2",
        // uncached input = (8649+123+100) - (5376+64) = 3432
        inputTokens: 8649 + 123 + 100 - (5376 + 64),
        outputTokens: 54,
        cacheReadTokens: 5440,
        cacheWriteTokens: 0,
      },
    ]);
  });

  it("splits per model and attributes each session independently", async () => {
    await seedUsage([
      ["main", "GLM-5.2", "main_turn", 1000, 100, 0, 0],
      ["main", "claude-sonnet-5", "main_turn", 500, 50, 0, 0],
      ["sess_subagent_agent_x", "GLM-5.2", "subagent", 200, 20, 0, 0],
    ]);
    const usage = getZcodeModelUsage(["main", "sess_subagent_agent_x"]);
    expect(
      usage
        ?.get("main")
        ?.map((u) => u.model)
        .sort(),
    ).toEqual(["GLM-5.2", "claude-sonnet-5"]);
    // The parent never absorbs the subagent's tokens.
    expect(usage?.get("sess_subagent_agent_x")).toEqual([
      {
        model: "GLM-5.2",
        inputTokens: 200,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    ]);
  });

  it("keeps a zero-token model row so failed sessions still have a model", async () => {
    await seedUsage([["s_err", "GLM-5.2", "main_turn", 0, 0, 0, 0]]);
    expect(getZcodeModelUsage(["s_err"])?.get("s_err")).toEqual([
      {
        model: "GLM-5.2",
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    ]);
  });

  it("ignores rows with no model and returns nothing for unknown ids", async () => {
    await seedUsage([["s1", null, "main_turn", 10, 1, 0, 0]]);
    const usage = getZcodeModelUsage(["s1", "missing"]);
    expect(usage?.has("s1")).toBe(false);
    expect(usage?.has("missing")).toBe(false);
  });

  it("returns undefined when the database is unavailable", async () => {
    __resetZcodeDbCache();
    delete process.env.ZCODE_DB_PATH;
    process.env.ZCODE_DB_PATH = "/nonexistent/agentarium-zcode-missing.db";
    __resetZcodeDbCache();
    expect(getZcodeModelUsage(["s1"])).toBeUndefined();
  });
});

const AUTOMATIONS_SCHEMA = `
  CREATE TABLE automations (
    automation_id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    cron_expr TEXT NOT NULL,
    prompt TEXT NOT NULL,
    model TEXT,
    workspace_path TEXT NOT NULL,
    recurring INTEGER NOT NULL DEFAULT 1,
    max_runs INTEGER,
    run_count INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    lifecycle_status TEXT NOT NULL DEFAULT 'active',
    next_run_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;

describe("Zcode v2 automations", () => {
  interface AutomationSeed {
    id: string;
    title?: string;
    cronExpr?: string;
    prompt?: string;
    model?: string;
    workspacePath?: string;
    recurring?: number;
    maxRuns?: number | null;
    runCount?: number;
    enabled?: number;
    lifecycleStatus?: string;
    nextRunAt?: number | null;
  }

  async function seedAutomations(rows: AutomationSeed[]): Promise<string> {
    const dbPath = await zcodeFixture(
      AUTOMATIONS_SCHEMA,
      "ZCODE_TASKS_DB_PATH",
    );
    const db = new Database(dbPath);
    const insert = db.prepare(`INSERT INTO automations
      (automation_id, title, cron_expr, prompt, model, workspace_path,
       recurring, max_runs, run_count, enabled, lifecycle_status,
       next_run_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const row of rows) {
      insert.run(
        row.id,
        row.title ?? "Weekly digest",
        row.cronExpr ?? "0 15 * * 0",
        row.prompt ?? "Run the digest.",
        row.model ?? null,
        row.workspacePath ?? "/Users/test/project",
        row.recurring ?? 1,
        row.maxRuns ?? null,
        row.runCount ?? 0,
        row.enabled ?? 1,
        row.lifecycleStatus ?? "active",
        row.nextRunAt ?? null,
        1_755_400_000_000,
        1_755_400_000_000,
      );
    }
    db.close();
    __resetZcodeDbCache();
    return dbPath;
  }

  it("maps the display-safe columns of an active automation", async () => {
    await seedAutomations([
      {
        id: "automation-1",
        title: "Sundays 3pm: weekly digest review",
        cronExpr: "0 15 * * 0",
        prompt: "Run the weekly digest edit.",
        model: "builtin:zai-coding-plan/GLM-5.3",
        workspacePath: "/Users/test/ai-compass",
        maxRuns: 10,
        runCount: 3,
        nextRunAt: 1_755_900_000_000,
      },
    ]);
    expect(listZcodeAutomations()).toEqual([
      {
        id: "automation-1",
        title: "Sundays 3pm: weekly digest review",
        cronExpr: "0 15 * * 0",
        prompt: "Run the weekly digest edit.",
        model: "builtin:zai-coding-plan/GLM-5.3",
        workspacePath: "/Users/test/ai-compass",
        recurring: true,
        maxRuns: 10,
        runCount: 3,
        enabled: true,
        lifecycleStatus: "active",
        nextRunAt: 1_755_900_000_000,
        timeCreated: 1_755_400_000_000,
        timeUpdated: 1_755_400_000_000,
      },
    ]);
  });

  it("reads paused and completed lifecycle rows", async () => {
    await seedAutomations([
      { id: "a-paused", enabled: 0, lifecycleStatus: "active" },
      { id: "a-done", enabled: 1, lifecycleStatus: "completed" },
    ]);
    const automations = listZcodeAutomations() ?? [];
    expect(automations.find((a) => a.id === "a-paused")?.enabled).toBe(false);
    expect(automations.find((a) => a.id === "a-done")?.lifecycleStatus).toBe(
      "completed",
    );
  });

  it("returns undefined when the automations table is missing", async () => {
    await zcodeFixture("", "ZCODE_TASKS_DB_PATH");
    expect(listZcodeAutomations()).toBeUndefined();
  });

  it("returns undefined when the tasks database is unavailable", async () => {
    process.env.ZCODE_TASKS_DB_PATH =
      "/nonexistent/agentarium-zcode-tasks-missing.db";
    __resetZcodeDbCache();
    expect(listZcodeAutomations()).toBeUndefined();
  });
});
