import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { Database as BetterSqlite3Database } from "better-sqlite3";

const dbConnections = new Map<string, BetterSqlite3Database>();

function firstExisting(...candidates: string[]): string | undefined {
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function codexStateDbPath(): string | undefined {
  if (process.env.CODEX_STATE_DB_PATH)
    return path.resolve(process.env.CODEX_STATE_DB_PATH);

  return firstExisting(
    path.join(os.homedir(), ".codex", "state_5.sqlite"),
    path.join(os.homedir(), ".codex", "sqlite", "state_5.sqlite"),
  );
}

function codexCatalogDbPath(): string | undefined {
  if (process.env.CODEX_CATALOG_DB_PATH)
    return path.resolve(process.env.CODEX_CATALOG_DB_PATH);

  return firstExisting(
    path.join(os.homedir(), ".codex", "sqlite", "codex-dev.db"),
    path.join(os.homedir(), ".codex", "codex-dev.db"),
  );
}

function openDb(dbPath: string | undefined): BetterSqlite3Database | undefined {
  if (!dbPath) return undefined;
  const cached = dbConnections.get(dbPath);
  if (cached) return cached;
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    dbConnections.set(dbPath, db);
    return db;
  } catch {
    return undefined;
  }
}

function cleanTitle(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// Current Codex app builds keep the thread list in the dev database's
// local_thread_catalog; the legacy state_5 threads table stopped receiving
// updates, so consult the catalog first and keep threads as a fallback.
export function getCodexThreadTitle(threadId: string): string | undefined {
  const catalog = openDb(codexCatalogDbPath());
  try {
    const row = catalog
      ?.prepare(
        `SELECT display_title FROM local_thread_catalog
         WHERE thread_id = ? AND missing_candidate = 0
         ORDER BY source_recency_at DESC, source_created_at DESC, host_id
         LIMIT 1`,
      )
      .get(threadId) as { display_title?: unknown } | undefined;
    const catalogTitle = cleanTitle(row?.display_title);
    if (catalogTitle) return catalogTitle;
  } catch {
    // Fall through to the legacy store.
  }

  const state = openDb(codexStateDbPath());
  try {
    const row = state
      ?.prepare("SELECT title FROM threads WHERE id = ?")
      .get(threadId) as { title?: unknown } | undefined;
    return cleanTitle(row?.title);
  } catch {
    return undefined;
  }
}

export function __resetCodexDbCache(): void {
  for (const db of dbConnections.values()) db.close();
  dbConnections.clear();
}
