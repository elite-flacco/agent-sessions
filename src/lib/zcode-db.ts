import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { Database as BetterSqlite3Database } from "better-sqlite3";

export interface ZcodeSessionMetadata {
  id?: string;
  directory?: string;
  title?: string;
  parentId?: string;
  taskType?: string;
  titleSource?: string;
  timeCreated?: number;
  timeUpdated?: number;
}

export interface ZcodeStoredPart {
  id: string;
  timeCreated: number;
  data: unknown;
}

export interface ZcodeStoredMessage {
  id: string;
  timeCreated: number;
  data: unknown;
  parts: ZcodeStoredPart[];
}

const zcodeDbPath = (): string =>
  process.env.ZCODE_DB_PATH
    ? path.resolve(process.env.ZCODE_DB_PATH)
    : path.join(os.homedir(), ".zcode", "cli", "db", "db.sqlite");

const dbConnections = new Map<string, BetterSqlite3Database>();

function zcodeDb(): BetterSqlite3Database | undefined {
  const dbPath = zcodeDbPath();
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

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function parseData(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function metadata(row: Record<string, unknown>): ZcodeSessionMetadata {
  return {
    id: stringValue(row.id),
    directory: stringValue(row.directory),
    title: stringValue(row.title),
    parentId: stringValue(row.parent_id),
    taskType: stringValue(row.task_type),
    titleSource: stringValue(row.title_source),
    timeCreated:
      typeof row.time_created === "number" ? row.time_created : undefined,
    timeUpdated:
      typeof row.time_updated === "number" ? row.time_updated : undefined,
  };
}

export function getZcodeSessionMetadata(
  sessionId: string,
): ZcodeSessionMetadata | undefined {
  const db = zcodeDb();
  if (!db) return undefined;
  try {
    const row = db
      .prepare("SELECT * FROM session WHERE id = ?")
      .get(sessionId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return metadata(row);
  } catch {
    return undefined;
  }
}

export function listZcodeSessionMetadata(): ZcodeSessionMetadata[] | undefined {
  const db = zcodeDb();
  if (!db) return undefined;
  try {
    return (
      db
        .prepare("SELECT * FROM session ORDER BY time_created, id")
        .all() as Array<Record<string, unknown>>
    ).map(metadata);
  } catch {
    return undefined;
  }
}

export function readZcodeSessionMessages(
  sessionId: string,
): ZcodeStoredMessage[] | undefined {
  const db = zcodeDb();
  if (!db) return undefined;
  try {
    const messageRows = db
      .prepare(
        `SELECT id, time_created timeCreated, data
         FROM message
         WHERE session_id = ?
         ORDER BY time_created, id`,
      )
      .all(sessionId) as Array<{
      id: string;
      timeCreated: number;
      data: string;
    }>;
    const partRows = db
      .prepare(
        `SELECT id, message_id messageId, time_created timeCreated, data
         FROM part
         WHERE session_id = ?
         ORDER BY time_created, id`,
      )
      .all(sessionId) as Array<{
      id: string;
      messageId: string;
      timeCreated: number;
      data: string;
    }>;
    const partsByMessage = new Map<string, ZcodeStoredPart[]>();
    for (const row of partRows) {
      const parts = partsByMessage.get(row.messageId) ?? [];
      parts.push({
        id: row.id,
        timeCreated: row.timeCreated,
        data: parseData(row.data),
      });
      partsByMessage.set(row.messageId, parts);
    }
    return messageRows.map((row) => ({
      id: row.id,
      timeCreated: row.timeCreated,
      data: parseData(row.data),
      parts: partsByMessage.get(row.id) ?? [],
    }));
  } catch {
    return undefined;
  }
}

export interface ZcodeWorkflowDefinition {
  id: string;
  name: string;
  source: string;
  trusted: boolean;
  enabled: boolean;
  scriptPath?: string;
  scriptHash: string;
  metaJson: string;
  scope: string;
  timeCreated: number;
  timeUpdated: number;
}

/**
 * Reads scheduled-workflow definitions from Zcode's session database. Returns
 * undefined when the database or table is unavailable so callers can degrade
 * to an empty scheduled-task list rather than throwing.
 */
export function listZcodeWorkflowDefinitions():
  ZcodeWorkflowDefinition[] | undefined {
  const db = zcodeDb();
  if (!db) return undefined;
  try {
    const rows = db
      .prepare(
        `SELECT id, name, source, trusted, enabled, script_path scriptPath,
                script_hash scriptHash, meta_json metaJson, scope,
                time_created timeCreated, time_updated timeUpdated
         FROM workflow_definition`,
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: stringValue(row.id) ?? "",
      name: stringValue(row.name) ?? "",
      source: stringValue(row.source) ?? "",
      trusted: Number(row.trusted) === 1,
      enabled: Number(row.enabled) === 1,
      scriptPath: stringValue(row.scriptPath),
      scriptHash: stringValue(row.scriptHash) ?? "",
      metaJson: stringValue(row.metaJson) ?? "{}",
      scope: stringValue(row.scope) ?? "user",
      timeCreated: typeof row.timeCreated === "number" ? row.timeCreated : 0,
      timeUpdated: typeof row.timeUpdated === "number" ? row.timeUpdated : 0,
    }));
  } catch {
    return undefined;
  }
}

// Tests switch ZCODE_DB_PATH between isolated databases. Closing cached
// read-only handles keeps those fixtures independent and removable.
export function __resetZcodeDbCache(): void {
  for (const db of dbConnections.values()) {
    try {
      db.close();
    } catch {
      // A closed or locked handle is safe to forget.
    }
  }
  dbConnections.clear();
}
