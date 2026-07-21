import fs from "node:fs/promises";
import path from "node:path";
import type {
  ActivityEvent,
  AgentProvider,
  ModelUsage,
  NormalizedSession,
  ParseResult,
  TerminalStatus,
} from "@/lib/types";
import {
  parseLines,
  record,
  repositoryFromCwd,
  safeTitle,
  staleStatus,
  stringValue,
} from "../utils";

export interface JsonlStrategy {
  provider: AgentProvider;
  fallbackTitle: string;
  identify(rows: Record<string, unknown>[], filePath: string): string;
  cwd(rows: Record<string, unknown>[]): string | undefined;
  branch(rows: Record<string, unknown>[]): string | undefined;
  title(rows: Record<string, unknown>[]): string | undefined;
  hierarchy?(rows: Record<string, unknown>[]): {
    parentExternalId?: string;
    sessionKind?: "main" | "subagent";
    agentLabel?: string;
    agentDepth?: number;
  };
  terminalStatus(rows: Record<string, unknown>[]): TerminalStatus | undefined;
  events(rows: Record<string, unknown>[]): ActivityEvent[];
  usage?(rows: Record<string, unknown>[]): ModelUsage[];
}

export function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

export function accumulateUsage(
  map: Map<string, ModelUsage>,
  model: string,
  tokens: Pick<
    ModelUsage,
    "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens"
  >,
  reportedCostUsd?: number,
): void {
  const entry = map.get(model) ?? {
    model,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  entry.inputTokens += tokens.inputTokens;
  entry.outputTokens += tokens.outputTokens;
  entry.cacheReadTokens += tokens.cacheReadTokens;
  entry.cacheWriteTokens += tokens.cacheWriteTokens;
  if (reportedCostUsd !== undefined)
    entry.reportedCostUsd = (entry.reportedCostUsd ?? 0) + reportedCostUsd;
  map.set(model, entry);
}

export function dominantModel(usage: ModelUsage[]): string | undefined {
  const total = (u: ModelUsage) =>
    u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens;
  return [...usage].sort((a, b) => total(b) - total(a))[0]?.model;
}

const providerDisplayName = (provider: AgentProvider): string =>
  provider === "claude"
    ? "Claude Code"
    : provider === "pi"
      ? "Pi"
      : provider === "zcode"
        ? "Zcode"
        : "Codex";

export function sessionSummary(provider: AgentProvider, cwd?: string): string {
  const workspace = repositoryFromCwd(cwd) ?? "an unknown workspace";
  return `${providerDisplayName(provider)} session in ${workspace}.`;
}

export function timestamp(row: Record<string, unknown>): string | undefined {
  return (
    stringValue(row.timestamp) ??
    stringValue(row.startedAt) ??
    stringValue(row.completedAt)
  );
}

export function contentText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const texts = value.flatMap((item) => {
      const itemRecord = record(item);
      const text =
        stringValue(itemRecord?.text) ?? contentText(itemRecord?.content);
      return text ? [text] : [];
    });
    return texts.length ? texts.join("\n") : undefined;
  }
  const valueRecord = record(value);
  if (!valueRecord) return undefined;
  return stringValue(valueRecord.text) ?? contentText(valueRecord.content);
}

export function numberedEvent(
  row: Record<string, unknown>,
  index: number,
  kind: ActivityEvent["kind"],
  title: string,
  detail?: string,
): ActivityEvent {
  return {
    externalId:
      stringValue(row.uuid) ??
      stringValue(row.id) ??
      stringValue(row.turnId) ??
      `${index}-${kind}`,
    kind,
    title,
    detail,
    occurredAt: timestamp(row) ?? new Date(0).toISOString(),
  };
}

export async function parseJsonl(
  filePath: string,
  strategy: JsonlStrategy,
): Promise<ParseResult> {
  try {
    const rows = parseLines(await fs.readFile(filePath, "utf8")).flatMap(
      (value) => {
        const row = record(value);
        return row ? [row] : [];
      },
    );
    if (!rows.length) {
      return {
        sessions: [],
        errors: [
          {
            provider: strategy.provider,
            sourcePath: filePath,
            code: "parse_error",
            message: "No valid JSONL records",
            occurredAt: new Date().toISOString(),
          },
        ],
      };
    }
    const timestamps = rows
      .map(timestamp)
      .filter((value): value is string => Boolean(value))
      .sort();
    const stat = await fs.stat(filePath);
    const startedAt = timestamps[0] ?? stat.birthtime.toISOString();
    const updatedAt = timestamps.at(-1) ?? stat.mtime.toISOString();
    const cwd = strategy.cwd(rows);
    const title = safeTitle(strategy.title(rows), strategy.fallbackTitle);
    const events = strategy
      .events(rows)
      .filter((event) => event.occurredAt !== new Date(0).toISOString())
      .slice(-40);
    const usage = (strategy.usage?.(rows) ?? []).filter(
      (entry) =>
        entry.inputTokens +
          entry.outputTokens +
          entry.cacheReadTokens +
          entry.cacheWriteTokens >
          0 || entry.reportedCostUsd !== undefined,
    );
    const terminalStatus = strategy.terminalStatus(rows);
    const derived = staleStatus(updatedAt, terminalStatus);
    const hierarchy = strategy.hierarchy?.(rows) ?? {};
    const session: NormalizedSession = {
      externalId: strategy.identify(rows, filePath),
      sourcePath: filePath,
      provider: strategy.provider,
      ...hierarchy,
      title,
      summary: sessionSummary(strategy.provider, cwd),
      repository: repositoryFromCwd(cwd),
      cwd,
      branch: strategy.branch(rows),
      status: derived.status,
      statusReason: derived.reason,
      startedAt,
      endedAt: terminalStatus ? updatedAt : undefined,
      updatedAt,
      model: dominantModel(usage),
      usage,
      events: events.length
        ? events
        : [
            {
              externalId: "started",
              kind: "started",
              title: "Session started",
              occurredAt: startedAt,
            },
          ],
    };
    return { sessions: [session], errors: [] };
  } catch (error) {
    return {
      sessions: [],
      errors: [
        {
          provider: strategy.provider,
          sourcePath: filePath,
          code: "read_error",
          message:
            error instanceof Error ? error.message : "Unable to read source",
          occurredAt: new Date().toISOString(),
        },
      ],
    };
  }
}

export function filenameId(filePath: string): string {
  return path.basename(filePath, ".jsonl");
}
