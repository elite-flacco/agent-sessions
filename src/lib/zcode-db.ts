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

export interface ZcodeToolUsage {
  toolCallId: string;
  toolName: string;
  startedAt: number;
}

export interface ZcodeModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

const zcodeDbPath = (): string =>
  process.env.ZCODE_DB_PATH
    ? path.resolve(process.env.ZCODE_DB_PATH)
    : path.join(os.homedir(), ".zcode", "cli", "db", "db.sqlite");

const dbConnections = new Map<string, BetterSqlite3Database>();
const ZCODE_SESSION_SELECT = `SELECT id, directory, title, parent_id,
  task_type, title_source, time_created, time_updated FROM session`;

export type ZcodeQueryResult<T> = { ok: true; value: T } | { ok: false };

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

export function isZcodeDbAvailable(): boolean {
  return zcodeDb() !== undefined;
}

/**
 * Capability coverage requires more than an open SQLite file: Relay must be
 * able to execute the authoritative session, message, part, and tool-usage
 * reads used during reconciliation. Preparing and running empty health queries
 * validates the required tables and columns without reading or retaining any
 * content.
 */
export function isZcodeCapabilityDbAvailable(): boolean {
  const db = zcodeDb();
  if (!db) return false;
  try {
    db.prepare(`${ZCODE_SESSION_SELECT} WHERE id = ? LIMIT 0`).all(
      "__relay_capability_health__",
    );
    db.prepare(
      `SELECT id, time_created timeCreated, data
       FROM message WHERE session_id = ? LIMIT 0`,
    ).all("__relay_capability_health__");
    db.prepare(
      `SELECT id, message_id messageId, time_created timeCreated, data
       FROM part WHERE session_id = ? LIMIT 0`,
    ).all("__relay_capability_health__");
    db.prepare(
      `SELECT tool_call_id toolCallId, tool_name toolName, started_at startedAt
       FROM tool_usage WHERE session_id = ? LIMIT 0`,
    ).all("__relay_capability_health__");
    return true;
  } catch {
    return false;
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
    return row ? metadata(row) : undefined;
  } catch {
    return undefined;
  }
}

export function getZcodeSessionMetadataResult(
  sessionId: string,
): ZcodeQueryResult<ZcodeSessionMetadata | undefined> {
  const db = zcodeDb();
  if (!db) return { ok: false };
  try {
    const row = db
      .prepare(`${ZCODE_SESSION_SELECT} WHERE id = ?`)
      .get(sessionId) as Record<string, unknown> | undefined;
    return { ok: true, value: row ? metadata(row) : undefined };
  } catch {
    return { ok: false };
  }
}

export function listZcodeSessionMetadata(): ZcodeSessionMetadata[] | undefined {
  const result = listZcodeSessionMetadataResult();
  return result.ok ? result.value : undefined;
}

export function listZcodeSessionMetadataResult(): ZcodeQueryResult<
  ZcodeSessionMetadata[]
> {
  const db = zcodeDb();
  if (!db) return { ok: false };
  try {
    const rows = db
      .prepare(`${ZCODE_SESSION_SELECT} ORDER BY time_created, id`)
      .all() as Array<Record<string, unknown>>;
    return { ok: true, value: rows.map(metadata) };
  } catch {
    return { ok: false };
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

export function readZcodeToolUsage(
  sessionId: string,
): ZcodeToolUsage[] | undefined {
  const db = zcodeDb();
  if (!db) return undefined;
  try {
    return (
      db
        .prepare(
          `SELECT tool_call_id toolCallId, tool_name toolName, started_at startedAt
           FROM tool_usage WHERE session_id = ? ORDER BY started_at, tool_call_id`,
        )
        .all(sessionId) as Array<Record<string, unknown>>
    ).flatMap((row) => {
      const toolCallId = stringValue(row.toolCallId);
      const toolName = stringValue(row.toolName);
      return toolCallId && toolName && typeof row.startedAt === "number"
        ? [{ toolCallId, toolName, startedAt: row.startedAt }]
        : [];
    });
  } catch {
    return undefined;
  }
}

/**
 * Per-model token usage for the given sessions, read from the Zcode DB's
 * authoritative `model_usage` table. This is preferred over rollout `model_io`
 * parsing, which undercounts when Zcode prunes or truncates rollout files.
 *
 * All query sources (main_turn, subagent, session_title, compact) are summed —
 * it is all real model spend. Retries do not duplicate: each request is one row
 * (`attempt_index` is always 0; retries are tracked by `retry_count`). Subagent
 * rows carry their own `session_id`, so a parent never absorbs child tokens.
 * `input_tokens` is cache-inclusive, so uncached input is the remainder after
 * removing cache reads and writes, matching the rollout adapter's treatment.
 *
 * Returns a map keyed by session id; sessions with no rows are absent. Returns
 * undefined when the database is unavailable so callers keep rollout usage.
 */
export function getZcodeModelUsage(
  sessionIds: string[],
): Map<string, ZcodeModelUsage[]> | undefined {
  const db = zcodeDb();
  if (!db) return undefined;
  const result = new Map<string, ZcodeModelUsage[]>();
  try {
    const chunkSize = 500;
    for (let i = 0; i < sessionIds.length; i += chunkSize) {
      const chunk = sessionIds.slice(i, i + chunkSize);
      if (!chunk.length) continue;
      const rows = db
        .prepare(
          `SELECT session_id sessionId, model_id model,
             SUM(input_tokens) input, SUM(output_tokens) output,
             SUM(cache_read_input_tokens) cacheRead,
             SUM(cache_creation_input_tokens) cacheWrite
           FROM model_usage
           WHERE session_id IN (${chunk.map(() => "?").join(", ")})
             AND model_id IS NOT NULL AND model_id != ''
           GROUP BY session_id, model_id`,
        )
        .all(...chunk) as Array<Record<string, unknown>>;
      for (const row of rows) {
        const sessionId = stringValue(row.sessionId);
        const model = stringValue(row.model);
        if (!sessionId || !model) continue;
        const num = (value: unknown): number =>
          typeof value === "number" && Number.isFinite(value) && value > 0
            ? value
            : 0;
        const cacheRead = num(row.cacheRead);
        const cacheWrite = num(row.cacheWrite);
        const usage: ZcodeModelUsage = {
          model,
          inputTokens: Math.max(0, num(row.input) - cacheRead - cacheWrite),
          outputTokens: num(row.output),
          cacheReadTokens: cacheRead,
          cacheWriteTokens: cacheWrite,
        };
        const list = result.get(sessionId) ?? [];
        list.push(usage);
        result.set(sessionId, list);
      }
    }
    return result;
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
