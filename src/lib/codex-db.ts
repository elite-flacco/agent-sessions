import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { Database as BetterSqlite3Database } from "better-sqlite3";

const dbConnections = new Map<string, BetterSqlite3Database>();

function codexStateDbPath(): string | undefined {
  if (process.env.CODEX_STATE_DB_PATH)
    return path.resolve(process.env.CODEX_STATE_DB_PATH);

  const candidates = [
    path.join(os.homedir(), ".codex", "state_5.sqlite"),
    path.join(os.homedir(), ".codex", "sqlite", "state_5.sqlite"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function codexStateDb(): BetterSqlite3Database | undefined {
  const dbPath = codexStateDbPath();
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

export function getCodexThreadTitle(threadId: string): string | undefined {
  const db = codexStateDb();
  if (!db) return undefined;
  try {
    const row = db
      .prepare("SELECT title FROM threads WHERE id = ?")
      .get(threadId) as { title?: unknown } | undefined;
    return typeof row?.title === "string" && row.title.trim()
      ? row.title.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

export function __resetCodexDbCache(): void {
  for (const db of dbConnections.values()) db.close();
  dbConnections.clear();
}
