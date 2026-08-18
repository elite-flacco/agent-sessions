import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { __resetZcodeDbCache } from "@/lib/zcode-db";
import { discoverZcodeScheduledTasks } from "./zcode";

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

const WORKFLOW_SCHEMA = `
  CREATE TABLE IF NOT EXISTS workflow_definition (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, source TEXT NOT NULL,
    trusted INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
    script_path TEXT, script_hash TEXT NOT NULL, meta_json TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'user',
    time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL
  );
`;

interface AutomationSeed {
  id: string;
  title?: string;
  cronExpr?: string;
  prompt?: string;
  model?: string;
  workspacePath?: string;
  maxRuns?: number | null;
  runCount?: number;
  enabled?: number;
  lifecycleStatus?: string;
  nextRunAt?: number | null;
}

const temporaryDirectories: string[] = [];

async function tempDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "agentarium-zcode-inventory-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

async function seedTasksDatabase(
  directory: string,
  rows: AutomationSeed[],
): Promise<void> {
  const dbPath = path.join(directory, "tasks-index.sqlite");
  const db = new Database(dbPath);
  db.exec(AUTOMATIONS_SCHEMA);
  const insert = db.prepare(`INSERT INTO automations
    (automation_id, title, cron_expr, prompt, model, workspace_path,
     recurring, max_runs, run_count, enabled, lifecycle_status,
     next_run_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 1755400000000, 1755400000000)`);
  for (const row of rows) {
    insert.run(
      row.id,
      row.title ?? "Weekly digest",
      row.cronExpr ?? "0 15 * * 0",
      row.prompt ?? "Run the digest.",
      row.model ?? null,
      row.workspacePath ?? "/Users/test/project",
      row.maxRuns ?? null,
      row.runCount ?? 0,
      row.enabled ?? 1,
      row.lifecycleStatus ?? "active",
      row.nextRunAt ?? null,
    );
  }
  db.close();
  process.env.ZCODE_TASKS_DB_PATH = dbPath;
  __resetZcodeDbCache();
}

// Keeps the legacy workflow reader inert except in the merge test, so the
// suite stays hermetic on machines with a real ~/.zcode session database.
function isolateLegacyDatabase(): void {
  process.env.ZCODE_DB_PATH = "/nonexistent/agentarium-zcode-legacy.db";
  __resetZcodeDbCache();
}

async function seedLegacyWorkflow(
  directory: string,
  row: { id: string; name: string; scriptBody?: string; enabled?: number },
): Promise<void> {
  const dbPath = path.join(directory, "legacy.sqlite");
  const scriptPath = path.join(directory, `${row.id}.mjs`);
  await fs.writeFile(scriptPath, row.scriptBody ?? "// workflow\n");
  const db = new Database(dbPath);
  db.exec(WORKFLOW_SCHEMA);
  db.prepare(
    `INSERT INTO workflow_definition
     (id, name, source, trusted, enabled, script_path, script_hash,
      meta_json, scope, time_created, time_updated)
     VALUES (?, ?, 'user', 1, ?, ?, 'hash', '{}', 'user', 1755300000000, 1755300000000)`,
  ).run(row.id, row.name, row.enabled ?? 1, scriptPath);
  db.close();
  process.env.ZCODE_DB_PATH = dbPath;
  __resetZcodeDbCache();
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

describe("discoverZcodeScheduledTasks", () => {
  it("maps a v2 automation onto the full scheduled-task shape", async () => {
    const directory = await tempDirectory();
    await seedTasksDatabase(directory, [
      {
        id: "automation-1",
        title: "Sundays 3pm: weekly digest review",
        cronExpr: "0 15 * * 0",
        prompt: "Run the AI Compass weekly work-digest edit.\nExtra detail.",
        model: "builtin:zai-coding-plan/GLM-5.3",
        workspacePath: "/Users/test/ai-compass",
        maxRuns: 10,
        runCount: 3,
        nextRunAt: 1_755_900_000_000,
      },
    ]);
    isolateLegacyDatabase();

    const tasks = await discoverZcodeScheduledTasks();
    expect(tasks).toEqual([
      {
        id: "automation-1",
        name: "Sundays 3pm: weekly digest review",
        description: "Run the AI Compass weekly work-digest edit.",
        provider: "zcode",
        scheduleRaw: "0 15 * * 0",
        scheduleHuman: "Sundays at 3:00 PM",
        scheduleMissing: false,
        status: "active",
        model: "builtin:zai-coding-plan/GLM-5.3",
        workingDirectories: ["/Users/test/ai-compass"],
        instructionBody:
          "Run the AI Compass weekly work-digest edit.\nExtra detail.",
        instructionFormat: "prompt",
        sourcePath: "/Users/test/ai-compass",
        createdAt: 1_755_400_000_000,
        updatedAt: 1_755_400_000_000,
        nextRunAt: 1_755_900_000_000,
        runCount: 3,
        maxRuns: 10,
        warnings: [],
      },
    ]);
  });

  it("derives paused, completed, and unknown statuses", async () => {
    const directory = await tempDirectory();
    await seedTasksDatabase(directory, [
      { id: "a-paused", enabled: 0 },
      { id: "a-done", lifecycleStatus: "completed" },
      { id: "a-weird", lifecycleStatus: "surprise" },
    ]);
    isolateLegacyDatabase();

    const tasks = await discoverZcodeScheduledTasks();
    const statusOf = (id: string) =>
      tasks.find((task) => task.id === id)?.status;
    expect(statusOf("a-paused")).toBe("paused");
    expect(statusOf("a-done")).toBe("completed");
    expect(statusOf("a-weird")).toBe("unknown");
  });

  it("falls back to the id and marks the schedule missing on sparse rows", async () => {
    const directory = await tempDirectory();
    await seedTasksDatabase(directory, [
      { id: "automation-sparse", title: "", cronExpr: "", prompt: "" },
    ]);
    isolateLegacyDatabase();

    const [task] = await discoverZcodeScheduledTasks();
    expect(task?.name).toBe("automation-sparse");
    expect(task?.scheduleMissing).toBe(true);
    expect(task?.scheduleRaw).toBeUndefined();
    expect(task?.scheduleHuman).toBeUndefined();
    expect(task?.instructionBody).toBeUndefined();
    expect(task?.description).toBeUndefined();
  });

  it("appends legacy workflow rows and prefers v2 on id collision", async () => {
    const directory = await tempDirectory();
    await seedTasksDatabase(directory, [{ id: "automation-1" }]);
    await seedLegacyWorkflow(directory, {
      id: "automation-1",
      name: "Legacy same id",
    });
    await seedLegacyWorkflow(directory, {
      id: "workflow-old",
      name: "Old workflow",
      scriptBody: "// legacy body\n",
    });

    const tasks = await discoverZcodeScheduledTasks();
    expect(tasks.map((task) => task.id).sort()).toEqual([
      "automation-1",
      "workflow-old",
    ]);
    const legacy = tasks.find((task) => task.id === "workflow-old");
    expect(legacy?.instructionFormat).toBe("script");
    expect(legacy?.instructionBody).toBe("// legacy body\n");
    expect(legacy?.scheduleMissing).toBe(true);
    // The v2 row won the shared id.
    expect(
      tasks.find((task) => task.id === "automation-1")?.instructionFormat,
    ).toBe("prompt");
  });

  it("returns an empty list when both stores are unavailable", async () => {
    isolateLegacyDatabase();
    process.env.ZCODE_TASKS_DB_PATH = "/nonexistent/agentarium-zcode-tasks.db";
    __resetZcodeDbCache();
    expect(await discoverZcodeScheduledTasks()).toEqual([]);
  });
});
