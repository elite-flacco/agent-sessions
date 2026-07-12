import Database from "better-sqlite3";
import type { Database as BetterSqlite3Database } from "better-sqlite3";
import { resolve } from "node:path";
import type { ModelUsage, ProviderAdapter } from "@/lib/types";
import {
  homePath,
  record,
  repositoryFromCwd,
  stringValue,
  walkJsonl,
} from "../utils";
import {
  accumulateUsage,
  contentText,
  filenameId,
  numberedEvent,
  parseJsonl,
  sessionSummary,
  tokenCount,
} from "./shared";

// ZCode's interactive ("rollout") JSONL rows carry no `cwd`, so the workspace
// is unknown from the rollout alone. ZCode's own session DB
// (`~/.zcode/cli/db/db.sqlite`, `session.directory`) is the authoritative
// source and is keyed by the same session id present in the JSONL rows. We open
// it read-only as a fallback; any open/query failure is a silent no-op.
const zcodeDbPath = (): string =>
  process.env.ZCODE_DB_PATH
    ? resolve(process.env.ZCODE_DB_PATH)
    : homePath(".zcode", "cli", "db", "db.sqlite");

const dbConnections = new Map<string, BetterSqlite3Database>();

function zcodeDirectoryDb(): BetterSqlite3Database | undefined {
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

function zcodeSessionDirectory(sessionId: string): string | undefined {
  const db = zcodeDirectoryDb();
  if (!db) return undefined;
  try {
    const row = db
      .prepare("SELECT directory FROM session WHERE id = ?")
      .get(sessionId) as { directory?: string } | undefined;
    return stringValue(row?.directory);
  } catch {
    return undefined;
  }
}

// Drop cached connections so tests can point ZCODE_DB_PATH at a fresh temp DB.
export function __resetZcodeDbCache(): void {
  for (const db of dbConnections.values()) {
    try {
      db.close();
    } catch {
      // ignore — a closed or locked handle is fine to drop
    }
  }
  dbConnections.clear();
}

export const zcodeAdapter: ProviderAdapter = {
  provider: "zcode",
  discover: async () => {
    const rollout = await walkJsonl(homePath(".zcode", "cli", "rollout"));
    const agents = await walkJsonl(homePath(".zcode", "cli", "agents"));
    return [...rollout, ...agents];
  },
  parse: async (filePath) => {
    const result = await parseJsonl(filePath, {
      provider: "zcode",
      fallbackTitle: "Zcode coding session",
      identify: (rows) =>
        stringValue(rows.find((row) => row.sessionId)?.sessionId) ??
        filenameId(filePath),
      cwd: (rows) => stringValue(rows.find((row) => row.cwd)?.cwd),
      branch: (rows) =>
        stringValue(rows.find((row) => row.gitBranch)?.gitBranch),
      title: (rows) => {
        const request = rows.map((row) => record(row.request)).find(Boolean);
        const candidate =
          contentText(request?.messages) ?? contentText(request?.content);
        if (
          candidate?.startsWith("Generate a concise title") ||
          candidate?.startsWith("You are ZCode")
        )
          return undefined;
        return candidate;
      },
      terminalStatus: (rows) => {
        for (const row of [...rows].reverse()) {
          if (row.status === "cancelled") return "interrupted";
          if (row.status === "failed") return "needs_attention";
          if (
            row.status === "completed" ||
            Boolean(row.completedAt) ||
            row.type === "result" ||
            row.type === "turn_complete"
          )
            return "completed";
        }
        return undefined;
      },
      // model_io rows carry response.usage (camelCase, one row per request);
      // its inputTokens includes cache traffic, so uncached input is the
      // remainder after subtracting reads and writes.
      usage: (rows) => {
        const byModel = new Map<string, ModelUsage>();
        for (const row of rows) {
          if (row.type !== "model_io") continue;
          const usage = record(record(row.response)?.usage);
          const model =
            stringValue(row.model) ?? stringValue(record(row.model)?.modelId);
          if (!usage || !model) continue;
          const cacheRead = tokenCount(usage.cacheReadTokens);
          const cacheWrite = tokenCount(usage.cacheWriteTokens);
          accumulateUsage(byModel, model, {
            inputTokens: Math.max(
              0,
              tokenCount(usage.inputTokens) - cacheRead - cacheWrite,
            ),
            outputTokens: tokenCount(usage.outputTokens),
            cacheReadTokens: cacheRead,
            cacheWriteTokens: cacheWrite,
          });
        }
        return [...byModel.values()];
      },
      events: (rows) =>
        rows.flatMap((row, index) => {
          if (row.type === "model_io")
            return [
              numberedEvent(
                row,
                index,
                "info",
                `Model request${stringValue(row.model) ? ` · ${stringValue(row.model)}` : ""}`,
              ),
            ];
          const message = record(row.message);
          const blocks = Array.isArray(message?.content) ? message.content : [];
          const tool = blocks
            .map(record)
            .find(
              (block) =>
                block?.type === "tool_use" || block?.type === "toolCall",
            );
          return tool
            ? [
                numberedEvent(
                  row,
                  index,
                  "tool",
                  `Used ${stringValue(tool.name) ?? "a tool"}`,
                ),
              ]
            : [];
        }),
    });

    // Rollout `model_io` rows carry no cwd; enrich from ZCode's session DB so
    // interactive sessions resolve their workspace/repository. Sessions that
    // already have a cwd (subagent transcripts) are left untouched.
    const session = result.sessions[0];
    if (session && !session.cwd) {
      const directory =
        session.externalId && zcodeSessionDirectory(session.externalId);
      if (directory) {
        session.cwd = directory;
        session.repository = repositoryFromCwd(directory);
        session.summary = sessionSummary("zcode", directory);
      }
    }
    return result;
  },
};
