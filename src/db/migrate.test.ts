import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];

const currentSessionColumns = [
  "id",
  "external_id",
  "source_path",
  "provider",
  "parent_external_id",
  "session_kind",
  "agent_label",
  "agent_depth",
  "title",
  "summary",
  "repository",
  "cwd",
  "branch",
  "status",
  "status_reason",
  "started_at",
  "ended_at",
  "updated_at",
  "files_changed",
  "additions",
  "deletions",
  "input_tokens",
  "output_tokens",
  "cached_tokens",
  "model",
  "estimated_cost_usd",
].sort();

const currentSessionIndexes = [
  "sessions_parent_idx",
  "sessions_provider_external_idx",
  "sessions_started_idx",
  "sessions_status_idx",
].sort();

const capabilityIndexes = [
  "capability_usage_kind_name_idx",
  "capability_usage_occurred_idx",
  "capability_usage_session_external_idx",
].sort();

const currentAdapterScanColumns = [
  "provider",
  "last_scan_at",
  "sources",
  "imported",
  "errors",
  "capability_reconciliation_complete",
].sort();

const legacyBoundaries = [
  { name: "base bootstrap", generation: 0 },
  { name: "source-path bootstrap", generation: 1 },
  { name: "hierarchy bootstrap", generation: 2 },
  { name: "status-reason bootstrap", generation: 3 },
  { name: "capability-usage bootstrap", generation: 4 },
  { name: "capability-reconciliation bootstrap", generation: 5 },
] as const;

function createLegacyDatabase(databasePath: string, generation: number): void {
  const columns = [
    "id INTEGER PRIMARY KEY AUTOINCREMENT",
    "external_id TEXT NOT NULL",
    ...(generation >= 1 ? ["source_path TEXT"] : []),
    "provider TEXT NOT NULL",
    ...(generation >= 2
      ? [
          "parent_external_id TEXT",
          "session_kind TEXT NOT NULL DEFAULT 'main'",
          "agent_label TEXT",
          "agent_depth INTEGER NOT NULL DEFAULT 0",
        ]
      : []),
    "title TEXT NOT NULL",
    "summary TEXT",
    "repository TEXT",
    "cwd TEXT",
    "branch TEXT",
    "status TEXT NOT NULL",
    ...(generation >= 3 ? ["status_reason TEXT"] : []),
    "started_at TEXT NOT NULL",
    "ended_at TEXT",
    "updated_at TEXT NOT NULL",
    "files_changed INTEGER",
    "additions INTEGER",
    "deletions INTEGER",
    "input_tokens INTEGER",
    "output_tokens INTEGER",
    "cached_tokens INTEGER",
    "model TEXT",
    "estimated_cost_usd REAL",
  ];
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE sessions (${columns.join(",\n")});
    CREATE UNIQUE INDEX sessions_provider_external_idx ON sessions(provider, external_id);
    CREATE INDEX sessions_started_idx ON sessions(started_at);
    CREATE INDEX sessions_status_idx ON sessions(status);
    ${generation >= 2 ? "CREATE INDEX sessions_parent_idx ON sessions(provider, parent_external_id);" : ""}
    CREATE TABLE adapter_scans (
      provider TEXT PRIMARY KEY,
      last_scan_at TEXT NOT NULL,
      sources INTEGER NOT NULL,
      imported INTEGER NOT NULL,
      errors INTEGER NOT NULL
      ${generation >= 5 ? ", capability_reconciliation_complete INTEGER NOT NULL DEFAULT 0" : ""}
    );
    ${
      generation >= 4
        ? `CREATE TABLE session_capability_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            external_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            kind TEXT NOT NULL,
            capability_name TEXT NOT NULL,
            occurred_at TEXT NOT NULL
          );
          CREATE UNIQUE INDEX capability_usage_session_external_idx ON session_capability_usage(session_id, external_id);
          CREATE INDEX capability_usage_kind_name_idx ON session_capability_usage(kind, capability_name);
          CREATE INDEX capability_usage_occurred_idx ON session_capability_usage(occurred_at);`
        : ""
    }
  `);
  database.close();
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("database migration baseline", () => {
  it.each(legacyBoundaries)(
    "applies every missing migration to a $name database",
    async ({ generation }) => {
      const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "relay-migrate-"),
      );
      directories.push(directory);
      const databasePath = path.join(directory, "relay.db");
      createLegacyDatabase(databasePath, generation);

      execFileSync(process.execPath, ["--import", "tsx", "src/db/migrate.ts"], {
        cwd: process.cwd(),
        env: { ...process.env, RELAY_DATABASE_PATH: databasePath },
        stdio: "pipe",
      });

      const migrated = new Database(databasePath, { readonly: true });
      const sessionColumns = (
        migrated.prepare("PRAGMA table_info(sessions)").all() as {
          name: string;
        }[]
      )
        .map((column) => column.name)
        .sort();
      const sessionIndexes = (
        migrated.prepare("PRAGMA index_list(sessions)").all() as {
          name: string;
        }[]
      )
        .map((index) => index.name)
        .sort();
      const capabilityTable = migrated
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_capability_usage'",
        )
        .get();
      const persistedCapabilityIndexes = (
        migrated
          .prepare("PRAGMA index_list(session_capability_usage)")
          .all() as { name: string }[]
      )
        .map((index) => index.name)
        .sort();
      const adapterScanColumns = (
        migrated.prepare("PRAGMA table_info(adapter_scans)").all() as {
          name: string;
        }[]
      )
        .map((column) => column.name)
        .sort();
      const migrationCount = (
        migrated
          .prepare("SELECT COUNT(*) count FROM __drizzle_migrations")
          .get() as { count: number }
      ).count;
      migrated.close();

      expect(sessionColumns).toEqual(currentSessionColumns);
      expect(sessionIndexes).toEqual(currentSessionIndexes);
      expect(capabilityTable).toBeDefined();
      expect(persistedCapabilityIndexes).toEqual(capabilityIndexes);
      expect(adapterScanColumns).toEqual(currentAdapterScanColumns);
      expect(migrationCount).toBe(8);
    },
  );
});
