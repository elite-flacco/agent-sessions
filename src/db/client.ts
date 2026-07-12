import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const databasePath = process.env.RELAY_DATABASE_PATH
  ? path.resolve(process.env.RELAY_DATABASE_PATH)
  : path.join(process.cwd(), "data", "relay.db");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const sqlite = new Database(databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

sqlite.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  repository TEXT,
  cwd TEXT,
  branch TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  updated_at TEXT NOT NULL,
  files_changed INTEGER,
  additions INTEGER,
  deletions INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_tokens INTEGER,
  model TEXT,
  estimated_cost_usd REAL
);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_provider_external_idx ON sessions(provider, external_id);
CREATE INDEX IF NOT EXISTS sessions_started_idx ON sessions(started_at);
CREATE INDEX IF NOT EXISTS sessions_status_idx ON sessions(status);
CREATE TABLE IF NOT EXISTS session_model_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL,
  reported_cost_usd REAL
);
CREATE UNIQUE INDEX IF NOT EXISTS usage_session_model_idx ON session_model_usage(session_id, model);
CREATE TABLE IF NOT EXISTS activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  occurred_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS events_session_external_idx ON activity_events(session_id, external_id);
CREATE TABLE IF NOT EXISTS ingestion_sources (
  path TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  size INTEGER NOT NULL,
  modified_at INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  last_synced_at TEXT NOT NULL,
  parse_state TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS adapter_scans (
  provider TEXT PRIMARY KEY,
  last_scan_at TEXT NOT NULL,
  sources INTEGER NOT NULL,
  imported INTEGER NOT NULL,
  errors INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS collector_leases (
  name TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  source_path TEXT NOT NULL,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
`);

export const db = drizzle(sqlite, { schema });
export { sqlite };
