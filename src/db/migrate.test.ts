import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("database migration baseline", () => {
  it("applies capability usage migration to a hierarchy-aware legacy database", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "relay-migrate-"),
    );
    directories.push(directory);
    const databasePath = path.join(directory, "relay.db");
    const database = new Database(databasePath);
    database.exec(`CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT NOT NULL,
      source_path TEXT,
      provider TEXT NOT NULL,
      parent_external_id TEXT,
      session_kind TEXT NOT NULL DEFAULT 'main',
      agent_label TEXT,
      agent_depth INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    database.close();

    execFileSync(process.execPath, ["--import", "tsx", "src/db/migrate.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, RELAY_DATABASE_PATH: databasePath },
      stdio: "pipe",
    });

    const migrated = new Database(databasePath, { readonly: true });
    const table = migrated
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_capability_usage'",
      )
      .get();
    migrated.close();
    expect(table).toBeDefined();
  });
});
