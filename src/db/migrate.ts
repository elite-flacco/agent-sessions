import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { resolveDatabasePath } from "./database-path";

const databasePath = resolveDatabasePath();
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const sqlite = new Database(databasePath);
const migrationsFolder = path.join(process.cwd(), "drizzle");

// Databases created by the early bootstrap SQL predate Drizzle's journal, and
// the runtime bootstrap in client.ts keeps creating whole tables with CREATE
// TABLE IF NOT EXISTS — so schema a migration would have added can already be
// present in a database that never recorded that migration. Reconcile the
// journal against the schema on every run (not just on an empty journal),
// otherwise re-running an already-satisfied migration aborts the run and
// strands every migration behind it.
const hasSessions = Boolean(
  sqlite
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sessions'",
    )
    .get(),
);
if (hasSessions) {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at numeric
  )`);
  const sessionColumns = new Set(
    (
      sqlite.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]
    ).map((column) => column.name),
  );
  const adapterScanColumns = new Set(
    (
      sqlite.prepare("PRAGMA table_info(adapter_scans)").all() as {
        name: string;
      }[]
    ).map((column) => column.name),
  );
  const hasTable = (name: string) =>
    Boolean(
      sqlite
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get(name),
    );

  // One predicate per migration, in migration order: "this migration's schema
  // is already present". The first three are covered by the base bootstrap.
  // Append a predicate here whenever a migration is added.
  const alreadyPresent: (() => boolean)[] = [
    () => true,
    () => true,
    () => true,
    () => sessionColumns.has("source_path"),
    () =>
      [
        "parent_external_id",
        "session_kind",
        "agent_label",
        "agent_depth",
      ].every((column) => sessionColumns.has(column)),
    () => sessionColumns.has("status_reason"),
    () => hasTable("session_capability_usage"),
    () => adapterScanColumns.has("capability_reconciliation_complete"),
  ];

  const migrations = readMigrationFiles({ migrationsFolder });
  let baselineCount = 0;
  while (baselineCount < migrations.length && alreadyPresent[baselineCount]?.())
    baselineCount += 1;

  // Drizzle treats the journal's newest created_at as a high-water mark, so
  // only rows past the current mark need recording.
  const highWaterMark = Number(
    (
      sqlite
        .prepare("SELECT MAX(created_at) mark FROM __drizzle_migrations")
        .get() as { mark: number | null }
    ).mark ?? -1,
  );
  const insert = sqlite.prepare(
    "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
  );
  sqlite.transaction(() => {
    for (const migration of migrations.slice(0, baselineCount))
      if (migration.folderMillis > highWaterMark)
        insert.run(migration.hash, migration.folderMillis);
  })();
}

migrate(drizzle(sqlite), { migrationsFolder });
sqlite.close();
console.log(`Agentarium database migrated at ${databasePath}`);
