import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";

const databasePath = process.env.RELAY_DATABASE_PATH
  ? path.resolve(process.env.RELAY_DATABASE_PATH)
  : path.join(process.cwd(), "data", "relay.db");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const sqlite = new Database(databasePath);
const migrationsFolder = path.join(process.cwd(), "drizzle");

// Databases created by the early bootstrap SQL predate Drizzle's journal.
// Establish a baseline from the columns that already exist before applying
// newer migrations, so `db:migrate` works for both existing and fresh files.
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
  const journalCount = (
    sqlite.prepare("SELECT COUNT(*) count FROM __drizzle_migrations").get() as {
      count: number;
    }
  ).count;
  if (journalCount === 0) {
    const columns = sqlite.prepare("PRAGMA table_info(sessions)").all() as {
      name: string;
    }[];
    const columnNames = new Set(columns.map((column) => column.name));
    const hasSourcePath = columnNames.has("source_path");
    const hasSessionHierarchy = [
      "parent_external_id",
      "session_kind",
      "agent_label",
      "agent_depth",
    ].every((column) => columnNames.has(column));
    const hasStatusReason = columnNames.has("status_reason");
    const hasCapabilityUsage = Boolean(
      sqlite
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session_capability_usage'",
        )
        .get(),
    );
    const adapterScanColumns = sqlite
      .prepare("PRAGMA table_info(adapter_scans)")
      .all() as { name: string }[];
    const hasCapabilityReconciliation = adapterScanColumns.some(
      (column) => column.name === "capability_reconciliation_complete",
    );
    const migrations = readMigrationFiles({ migrationsFolder });
    const baseline =
      hasCapabilityReconciliation &&
      hasCapabilityUsage &&
      hasStatusReason &&
      hasSessionHierarchy &&
      hasSourcePath
        ? migrations
        : hasCapabilityUsage &&
            hasStatusReason &&
            hasSessionHierarchy &&
            hasSourcePath
          ? migrations.slice(0, -1)
          : hasStatusReason && hasSessionHierarchy && hasSourcePath
            ? migrations.slice(0, -2)
            : hasSessionHierarchy && hasSourcePath
              ? migrations.slice(0, -3)
              : hasSourcePath
                ? migrations.slice(0, -4)
                : migrations.slice(0, -5);
    const insert = sqlite.prepare(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
    );
    sqlite.transaction(() => {
      for (const migration of baseline)
        insert.run(migration.hash, migration.folderMillis);
    })();
  }
}

migrate(drizzle(sqlite), { migrationsFolder });
sqlite.close();
console.log(`Relay database migrated at ${databasePath}`);
