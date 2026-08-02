import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import chokidar from "chokidar";
import type {
  AdapterParseContext,
  AgentProvider,
  CapabilityLookup,
  CapabilityUsage,
  NormalizedSession,
  ProviderAdapter,
  SessionStatus,
  StatusReason,
} from "@/lib/types";
import { getCodexThreadTitle } from "@/lib/codex-db";
import { sqlite } from "@/db/client";
import { getAgentInventories } from "@/lib/agent-inventory";
import {
  getZcodeModelUsage,
  getZcodeSessionMetadataResult,
  isZcodeCapabilityDbAvailable,
  isZcodeDbAvailable,
  listZcodeSessionMetadataResult,
  readZcodeSessionMessages,
  readZcodeToolUsage,
  type ZcodeStoredMessage,
} from "@/lib/zcode-db";
import { claudeAdapter } from "./adapters/claude";
import { codexAdapter } from "./adapters/codex";
import { piAdapter } from "./adapters/pi";
import { sessionSummary } from "./adapters/shared";
import { zcodeAdapter } from "./adapters/zcode";
import {
  buildCapabilityLookups,
  zcodeStoredCapabilityUsage,
} from "./capabilities";
import { acquireLease, releaseLease } from "./lock";
import {
  codexDelegationInput,
  homePath,
  record,
  repositoryFromCwd,
  safeTitle,
  staleStatus,
} from "./utils";

export const adapters: ProviderAdapter[] = [
  codexAdapter,
  claudeAdapter,
  zcodeAdapter,
  piAdapter,
];

export interface SourceRoot {
  path: string;
  provider: AgentProvider;
}

export const defaultRoots: SourceRoot[] = [
  { path: homePath(".codex", "sessions"), provider: "codex" },
  { path: homePath(".claude", "projects"), provider: "claude" },
  { path: homePath(".zcode", "cli", "rollout"), provider: "zcode" },
  { path: homePath(".zcode", "cli", "agents"), provider: "zcode" },
  { path: homePath(".pi", "agent", "sessions"), provider: "pi" },
];

const SYNC_LEASE_TTL_MS = 5 * 60 * 1000;
const WATCH_LEASE_TTL_MS = 90 * 1000;
const WATCH_LEASE_RENEW_MS = 30 * 1000;
const SYNC_ERROR_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const NORMALIZATION_VERSION = "14";

function fingerprint(size: number, modifiedAt: number): string {
  return crypto
    .createHash("sha1")
    .update(`${NORMALIZATION_VERSION}:${size}:${modifiedAt}`)
    .digest("hex");
}

function replaceCapabilityUsage(
  sessionId: number,
  provider: AgentProvider,
  capabilityUsage: CapabilityUsage[],
): void {
  sqlite
    .prepare("DELETE FROM session_capability_usage WHERE session_id = ?")
    .run(sessionId);
  const statement = sqlite.prepare(`INSERT INTO session_capability_usage
    (session_id, external_id, provider, kind, capability_name, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?)`);
  for (const capability of capabilityUsage) {
    statement.run(
      sessionId,
      capability.externalId,
      provider,
      capability.kind,
      capability.name,
      capability.occurredAt,
    );
  }
}

function persistSession(session: NormalizedSession): void {
  const write = sqlite.transaction(() => {
    const inputTokens = session.usage.reduce(
      (total, usage) => total + usage.inputTokens,
      0,
    );
    const outputTokens = session.usage.reduce(
      (total, usage) => total + usage.outputTokens,
      0,
    );
    const cachedTokens = session.usage.reduce(
      (total, usage) => total + usage.cacheReadTokens + usage.cacheWriteTokens,
      0,
    );
    sqlite
      .prepare(
        `INSERT INTO sessions (
        external_id, source_path, provider, parent_external_id, session_kind, agent_label, agent_depth,
        title, summary, repository, cwd, branch, status, status_reason, started_at, ended_at,
        updated_at, files_changed, additions, deletions, input_tokens, output_tokens, cached_tokens, model, estimated_cost_usd
      ) VALUES (
        @externalId, @sourcePath, @provider, @parentExternalId, @sessionKind, @agentLabel, @agentDepth,
        @title, @summary, @repository, @cwd, @branch, @status, @statusReason, @startedAt, @endedAt,
        @updatedAt, @filesChanged, @additions, @deletions, @inputTokens, @outputTokens, @cachedTokens, @model, @estimatedCostUsd
      ) ON CONFLICT(provider, external_id) DO UPDATE SET
        source_path=COALESCE(excluded.source_path, sessions.source_path), parent_external_id=excluded.parent_external_id,
        session_kind=excluded.session_kind, agent_label=excluded.agent_label, agent_depth=excluded.agent_depth,
        title=excluded.title, summary=excluded.summary, repository=COALESCE(excluded.repository, sessions.repository),
        cwd=COALESCE(excluded.cwd, sessions.cwd), branch=COALESCE(excluded.branch, sessions.branch), status=excluded.status,
        status_reason=excluded.status_reason,
        started_at=MIN(excluded.started_at, sessions.started_at), ended_at=COALESCE(excluded.ended_at, sessions.ended_at),
        updated_at=MAX(excluded.updated_at, sessions.updated_at), input_tokens=COALESCE(excluded.input_tokens, sessions.input_tokens),
        output_tokens=COALESCE(excluded.output_tokens, sessions.output_tokens), cached_tokens=COALESCE(excluded.cached_tokens, sessions.cached_tokens),
        model=COALESCE(excluded.model, sessions.model), estimated_cost_usd=COALESCE(excluded.estimated_cost_usd, sessions.estimated_cost_usd)`,
      )
      .run({
        ...session,
        sourcePath: session.sourcePath ?? null,
        parentExternalId: session.parentExternalId ?? null,
        sessionKind: session.sessionKind ?? "main",
        agentLabel: session.agentLabel ?? null,
        agentDepth: session.agentDepth ?? 0,
        summary: session.summary ?? null,
        repository: session.repository ?? null,
        cwd: session.cwd ?? null,
        branch: session.branch ?? null,
        statusReason: session.statusReason ?? null,
        endedAt: session.endedAt ?? null,
        filesChanged: session.filesChanged ?? null,
        additions: session.additions ?? null,
        deletions: session.deletions ?? null,
        inputTokens: session.usage.length ? inputTokens : null,
        outputTokens: session.usage.length ? outputTokens : null,
        cachedTokens: session.usage.length ? cachedTokens : null,
        model: session.model ?? null,
        estimatedCostUsd: null,
      });

    const row = sqlite
      .prepare("SELECT id FROM sessions WHERE provider = ? AND external_id = ?")
      .get(session.provider, session.externalId) as { id: number };
    replaceCapabilityUsage(row.id, session.provider, session.capabilityUsage);
    if (session.usage.length) {
      sqlite
        .prepare(
          `DELETE FROM session_model_usage WHERE session_id = ? AND model NOT IN (${session.usage.map(() => "?").join(", ")})`,
        )
        .run(row.id, ...session.usage.map((usage) => usage.model));
    }
    const usageStatement = sqlite.prepare(`INSERT INTO session_model_usage
      (session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reported_cost_usd)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(session_id, model) DO UPDATE SET
      input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens,
      cache_read_tokens=excluded.cache_read_tokens, cache_write_tokens=excluded.cache_write_tokens,
      reported_cost_usd=excluded.reported_cost_usd`);
    for (const usage of session.usage) {
      usageStatement.run(
        row.id,
        usage.model,
        usage.inputTokens,
        usage.outputTokens,
        usage.cacheReadTokens,
        usage.cacheWriteTokens,
        usage.reportedCostUsd ?? null,
      );
    }
    const eventStatement =
      sqlite.prepare(`INSERT INTO activity_events (session_id, external_id, kind, title, detail, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(session_id, external_id) DO UPDATE SET
      kind=excluded.kind, title=excluded.title, detail=excluded.detail, occurred_at=excluded.occurred_at`);
    for (const event of session.events) {
      eventStatement.run(
        row.id,
        event.externalId,
        event.kind,
        event.title,
        event.detail ?? null,
        event.occurredAt,
      );
    }
  });
  write();
}

function recordSyncError(
  provider: AgentProvider,
  sourcePath: string,
  code: string,
  message: string,
): void {
  sqlite
    .prepare(
      "INSERT INTO sync_errors (provider, source_path, code, message, occurred_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      provider,
      sourcePath,
      code,
      message.slice(0, 500),
      new Date().toISOString(),
    );
}

function firstZcodeUserText(
  messages: ZcodeStoredMessage[],
): string | undefined {
  for (const message of messages) {
    if (record(message.data)?.role !== "user") continue;
    for (const part of message.parts) {
      const data = record(part.data);
      if (data?.type === "text" && typeof data.text === "string")
        return data.text;
    }
  }
}

function zcodeTitle(
  fallback: string,
  taskType: string | undefined,
  messages: ZcodeStoredMessage[],
): string {
  if (taskType !== "subagent_child") return fallback;
  const prompt = firstZcodeUserText(messages);
  if (!prompt || !/review/i.test(prompt)) return fallback;
  const categories = [
    ...new Set(
      [...prompt.matchAll(/(?<![a-z-])skills\/([a-z-]+)\//gi)].map(
        (match) => match[1],
      ),
    ),
  ];
  if (!categories.length) return fallback;
  const labels = categories.map((category) =>
    category === "git"
      ? "Git"
      : category === "docs"
        ? "docs"
        : category.charAt(0).toUpperCase() + category.slice(1),
  );
  return safeTitle(`Review ${labels.join(" & ")} skills`, fallback);
}

// Maps a terminal Zcode error to a failure reason. `needs_attention` is
// reserved for an unresolved AskUserQuestion; a cancel is an abort, not a
// failure. Every other error is a `failed` outcome with a specific reason.
function classifyZcodeError(error: unknown): {
  status: "interrupted" | "failed";
  reason?: StatusReason;
} {
  const text = JSON.stringify(error);
  if (/cancel/i.test(text)) return { status: "interrupted" };
  if (/usage limit|rate limit/i.test(text))
    return { status: "failed", reason: "usage_limit" };
  if (/insufficient balance|no resource package|recharge/i.test(text))
    return { status: "failed", reason: "insufficient_balance" };
  if (/network connection failed/i.test(text))
    return { status: "failed", reason: "network_error" };
  if (/no text.*no tool calls|no usage before completing/i.test(text))
    return { status: "failed", reason: "model_error" };
  return { status: "failed", reason: "execution_error" };
}

function zcodeStoredStatus(
  messages: ZcodeStoredMessage[],
  updatedAt: string,
): { status: SessionStatus; reason?: StatusReason } {
  for (const message of [...messages].reverse()) {
    for (const part of [...message.parts].reverse()) {
      const data = record(part.data);
      const state = record(data?.state);
      if (
        data?.type === "tool" &&
        data.tool === "AskUserQuestion" &&
        state?.status === "running"
      )
        return { status: "needs_attention" };
    }
  }
  for (const message of [...messages].reverse()) {
    const data = record(message.data);
    if (!data) continue;
    if (data.error) return classifyZcodeError(data.error);
    if (data.role === "assistant") {
      // An assistant message with no `time.completed` and no error is a turn
      // still in flight. Stop here so staleStatus can derive running/incomplete
      // from updated_at — never skip past it to an older completed turn.
      if (!record(data.time)?.completed) break;
      return { status: "completed" };
    }
    if (data.role === "user") break;
  }
  return staleStatus(updatedAt);
}

function reconcileCodexTitles(): void {
  const sessions = sqlite
    .prepare(
      "SELECT id, external_id externalId, title FROM sessions WHERE provider = 'codex'",
    )
    .all() as Array<{ id: number; externalId: string; title: string }>;
  const update = sqlite.prepare("UPDATE sessions SET title = ? WHERE id = ?");
  const write = sqlite.transaction(() => {
    for (const session of sessions) {
      const title = getCodexThreadTitle(session.externalId);
      if (title)
        update.run(
          safeTitle(codexDelegationInput(title) ?? title, session.title),
          session.id,
        );
    }
  });
  write();
}

function reconcileZcodeMetadata(capabilityLookup?: CapabilityLookup): boolean {
  if (!isZcodeDbAvailable()) return false;
  let capabilityComplete = isZcodeCapabilityDbAvailable();
  const capabilityReplacements: Array<{
    sessionId: number;
    usage: CapabilityUsage[];
  }> = [];
  const databaseOnlySessions: NormalizedSession[] = [];

  try {
    const sessions = sqlite
      .prepare(
        "SELECT id, external_id externalId, title, cwd, status, updated_at updatedAt FROM sessions WHERE provider = 'zcode'",
      )
      .all() as Array<{
      id: number;
      externalId: string;
      title: string;
      cwd: string | null;
      status: string;
      updatedAt: string;
    }>;
    const update = sqlite.prepare(
      `UPDATE sessions
       SET title = ?, cwd = ?, repository = ?, summary = ?, parent_external_id = ?,
           session_kind = ?, agent_depth = ?, status = ?, status_reason = ?, ended_at = ?, updated_at = ?
       WHERE id = ?`,
    );
    const writeMetadata = sqlite.transaction(() => {
      for (const session of sessions) {
        const metadataResult = getZcodeSessionMetadataResult(
          session.externalId,
        );
        if (!metadataResult.ok) {
          capabilityComplete = false;
          continue;
        }
        const metadata = metadataResult.value;
        // A rollout can legitimately have no corresponding database session.
        // That is absence, not a failed query, so its rollout evidence stays.
        if (!metadata) continue;
        const cwd = metadata.directory ?? session.cwd ?? undefined;
        const storedMessages = readZcodeSessionMessages(session.externalId);
        const storedTools = readZcodeToolUsage(session.externalId);
        if (!storedMessages || !storedTools) capabilityComplete = false;
        const messages = storedMessages ?? [];
        const updatedAt =
          metadata.timeUpdated === undefined
            ? undefined
            : new Date(metadata.timeUpdated).toISOString();
        const storedStatus =
          messages.length && updatedAt
            ? zcodeStoredStatus(messages, updatedAt)
            : undefined;
        const keepInterrupted =
          session.status === "interrupted" &&
          (storedStatus?.status === "running" ||
            storedStatus?.status === "incomplete");
        const status = keepInterrupted
          ? session.status
          : (storedStatus?.status ?? session.status);
        const statusReason = keepInterrupted
          ? null
          : (storedStatus?.reason ?? null);
        // The Zcode DB is often fresher than the rollout JSONL (event-only
        // subagents, interactive turns). Advance updated_at so a genuinely
        // active session does not read as stale at query time.
        const freshestUpdatedAt =
          updatedAt && updatedAt > session.updatedAt
            ? updatedAt
            : session.updatedAt;
        update.run(
          zcodeTitle(
            safeTitle(metadata.title, session.title),
            metadata.taskType,
            messages,
          ),
          cwd ?? null,
          repositoryFromCwd(cwd) ?? null,
          sessionSummary("zcode", cwd),
          metadata.parentId ?? null,
          metadata.taskType === "subagent_child" ? "subagent" : "main",
          metadata.parentId ? 1 : 0,
          status,
          statusReason,
          status === "completed" ||
            status === "needs_attention" ||
            status === "failed"
            ? (updatedAt ?? null)
            : null,
          freshestUpdatedAt,
          session.id,
        );
        if (storedMessages && storedTools) {
          capabilityReplacements.push({
            sessionId: session.id,
            usage: zcodeStoredCapabilityUsage(
              storedMessages,
              storedTools,
              capabilityLookup,
            ),
          });
        }
      }
    });
    writeMetadata();

    const metadataListResult = listZcodeSessionMetadataResult();
    if (!metadataListResult.ok) capabilityComplete = false;
    const allMetadata = metadataListResult.ok ? metadataListResult.value : [];
    const existingIds = new Set(sessions.map((session) => session.externalId));
    for (const metadata of allMetadata) {
      if (existingIds.has(metadata.id ?? "")) continue;
      if (
        !metadata.id ||
        metadata.timeCreated === undefined ||
        metadata.timeUpdated === undefined
      ) {
        capabilityComplete = false;
        continue;
      }
      const startedAt = new Date(metadata.timeCreated).toISOString();
      const updatedAt = new Date(metadata.timeUpdated).toISOString();
      const storedMessages = readZcodeSessionMessages(metadata.id);
      const storedTools = readZcodeToolUsage(metadata.id);
      if (!storedMessages || !storedTools) {
        capabilityComplete = false;
        continue;
      }
      const { status, reason: statusReason } = zcodeStoredStatus(
        storedMessages,
        updatedAt,
      );
      databaseOnlySessions.push({
        externalId: metadata.id,
        provider: "zcode",
        parentExternalId: metadata.parentId,
        sessionKind:
          metadata.taskType === "subagent_child" ? "subagent" : "main",
        agentDepth: metadata.parentId ? 1 : 0,
        title: zcodeTitle(
          safeTitle(metadata.title, "Zcode coding session"),
          metadata.taskType,
          storedMessages,
        ),
        summary: sessionSummary("zcode", metadata.directory),
        repository: repositoryFromCwd(metadata.directory),
        cwd: metadata.directory,
        status,
        statusReason,
        startedAt,
        endedAt:
          status === "completed" ||
          status === "needs_attention" ||
          status === "failed"
            ? updatedAt
            : undefined,
        updatedAt,
        usage: [],
        capabilityUsage: zcodeStoredCapabilityUsage(
          storedMessages,
          storedTools,
          capabilityLookup,
        ),
        events: [
          {
            externalId: "started",
            kind: "started",
            title: "Session started",
            occurredAt: startedAt,
          },
        ],
      });
    }

    if (!capabilityComplete) return false;
    sqlite.transaction(() => {
      for (const replacement of capabilityReplacements) {
        replaceCapabilityUsage(
          replacement.sessionId,
          "zcode",
          replacement.usage,
        );
      }
    })();
    databaseOnlySessions.forEach(persistSession);
    return true;
  } catch {
    return false;
  }
}

/**
 * Replaces rollout-derived usage for zcode sessions with the authoritative
 * figures from the Zcode DB `model_usage` table. Rollout `model_io` parsing
 * undercounts when Zcode prunes or truncates rollout files, so the DB is the
 * primary source; the adapter path remains the fallback for sessions the DB
 * does not cover (or when the DB is unavailable). Runs after metadata
 * reconciliation so database-only sessions already exist. Idempotent.
 */
function reconcileZcodeUsage(): void {
  if (!isZcodeDbAvailable()) return;
  try {
    const sessions = sqlite
      .prepare(
        "SELECT id, external_id externalId FROM sessions WHERE provider = 'zcode'",
      )
      .all() as Array<{ id: number; externalId: string }>;
    if (!sessions.length) return;
    const usageBySession = getZcodeModelUsage(
      sessions.map((session) => session.externalId),
    );
    if (!usageBySession) return;
    const deleteUsage = sqlite.prepare(
      "DELETE FROM session_model_usage WHERE session_id = ?",
    );
    const insertUsage = sqlite.prepare(`INSERT INTO session_model_usage
      (session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reported_cost_usd)
      VALUES (?, ?, ?, ?, ?, ?, NULL)`);
    const updateSession = sqlite.prepare(
      "UPDATE sessions SET input_tokens = ?, output_tokens = ?, cached_tokens = ?, model = ? WHERE id = ?",
    );
    const write = sqlite.transaction(() => {
      for (const session of sessions) {
        const usage = usageBySession.get(session.externalId);
        if (!usage || !usage.length) continue;
        deleteUsage.run(session.id);
        let input = 0;
        let output = 0;
        let cached = 0;
        let dominantModel = usage[0].model;
        let dominantTotal = -1;
        for (const entry of usage) {
          insertUsage.run(
            session.id,
            entry.model,
            entry.inputTokens,
            entry.outputTokens,
            entry.cacheReadTokens,
            entry.cacheWriteTokens,
          );
          input += entry.inputTokens;
          output += entry.outputTokens;
          cached += entry.cacheReadTokens + entry.cacheWriteTokens;
          const total =
            entry.inputTokens +
            entry.outputTokens +
            entry.cacheReadTokens +
            entry.cacheWriteTokens;
          if (total > dominantTotal) {
            dominantTotal = total;
            dominantModel = entry.model;
          }
        }
        updateSession.run(input, output, cached, dominantModel, session.id);
      }
    });
    write();
  } catch {
    // Any failure leaves rollout-derived usage in place unchanged.
  }
}

async function syncFile(
  adapter: ProviderAdapter,
  filePath: string,
  force = false,
  context?: AdapterParseContext,
): Promise<{ imported: number; skipped: number; errors: number }> {
  const stat = await fs.stat(filePath);
  const currentFingerprint = fingerprint(stat.size, stat.mtimeMs);
  const existing = sqlite
    .prepare("SELECT fingerprint FROM ingestion_sources WHERE path = ?")
    .get(filePath) as { fingerprint: string } | undefined;
  if (!force && existing?.fingerprint === currentFingerprint)
    return { imported: 0, skipped: 1, errors: 0 };

  const result = await adapter.parse(filePath, context);
  result.sessions.forEach(persistSession);
  for (const error of result.errors)
    recordSyncError(
      error.provider,
      error.sourcePath,
      error.code,
      error.message,
    );
  if (!result.errors.length)
    sqlite
      .prepare("DELETE FROM sync_errors WHERE source_path = ?")
      .run(filePath);
  sqlite
    .prepare(
      `INSERT INTO ingestion_sources (path, provider, size, modified_at, fingerprint, last_synced_at, parse_state)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET size=excluded.size, modified_at=excluded.modified_at,
    fingerprint=excluded.fingerprint, last_synced_at=excluded.last_synced_at, parse_state=excluded.parse_state`,
    )
    .run(
      filePath,
      adapter.provider,
      stat.size,
      Math.round(stat.mtimeMs),
      currentFingerprint,
      new Date().toISOString(),
      result.errors.length ? "error" : "ok",
    );
  return {
    imported: result.sessions.length,
    skipped: 0,
    errors: result.errors.length,
  };
}

export interface SyncTotals {
  imported: number;
  skipped: number;
  errors: number;
  sources: number;
  locked: boolean;
}

interface SyncOptions {
  force?: boolean;
  adapters?: ProviderAdapter[];
  capabilityLookups?: Record<AgentProvider, CapabilityLookup>;
}

let syncInFlight: Promise<SyncTotals> | null = null;

/**
 * Incrementally ingest every discovered source. Concurrent calls within this
 * process share one run; a durable lease prevents a second process from
 * scanning at the same time.
 */
export function syncAll(options: SyncOptions = {}): Promise<SyncTotals> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = runSync(options).finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

async function runSync(options: SyncOptions): Promise<SyncTotals> {
  const totals: SyncTotals = {
    imported: 0,
    skipped: 0,
    errors: 0,
    sources: 0,
    locked: false,
  };
  if (!acquireLease("sync", SYNC_LEASE_TTL_MS)) {
    totals.locked = true;
    return totals;
  }
  try {
    // Clear the prior result before doing any work. If this run exits before
    // authoritative reconciliation completes, Insights must stay conservative.
    sqlite
      .prepare(
        `UPDATE adapter_scans
         SET capability_reconciliation_complete = 0
         WHERE provider = 'zcode'`,
      )
      .run();
    const selectedAdapters = options.adapters ?? adapters;
    const capabilityLookups =
      options.capabilityLookups ??
      buildCapabilityLookups(
        options.adapters ? [] : await getAgentInventories({ kind: "global" }),
      );
    sqlite
      .prepare("DELETE FROM sync_errors WHERE occurred_at < ?")
      .run(new Date(Date.now() - SYNC_ERROR_RETENTION_MS).toISOString());
    for (const adapter of selectedAdapters) {
      const scan = { sources: 0, imported: 0, errors: 0 };
      const paths = await adapter.discover();
      scan.sources = paths.length;
      for (const filePath of paths) {
        try {
          const result = await syncFile(adapter, filePath, options.force, {
            capabilities: capabilityLookups[adapter.provider],
          });
          scan.imported += result.imported;
          scan.errors += result.errors;
          totals.skipped += result.skipped;
        } catch (error) {
          scan.errors += 1;
          recordSyncError(
            adapter.provider,
            filePath,
            "read_error",
            error instanceof Error ? error.message : "Unknown sync error",
          );
        }
      }
      sqlite
        .prepare(
          `INSERT INTO adapter_scans (provider, last_scan_at, sources, imported, errors)
          VALUES (?, ?, ?, ?, ?) ON CONFLICT(provider) DO UPDATE SET
          last_scan_at=excluded.last_scan_at, sources=excluded.sources,
          imported=excluded.imported, errors=excluded.errors`,
        )
        .run(
          adapter.provider,
          new Date().toISOString(),
          scan.sources,
          scan.imported,
          scan.errors,
        );
      totals.sources += scan.sources;
      totals.imported += scan.imported;
      totals.errors += scan.errors;
    }
    reconcileCodexTitles();
    const capabilityReconciliationComplete = reconcileZcodeMetadata(
      capabilityLookups.zcode,
    );
    sqlite
      .prepare(
        `UPDATE adapter_scans
         SET capability_reconciliation_complete = ?
         WHERE provider = 'zcode'`,
      )
      .run(capabilityReconciliationComplete ? 1 : 0);
    reconcileZcodeUsage();
    return totals;
  } finally {
    releaseLease("sync");
  }
}

/**
 * Watch source roots for new and appended session files. Holds a durable
 * lease so only one watcher process ingests at a time; throws if another
 * live watcher already holds it.
 */
export async function watchSources(
  roots: SourceRoot[] = defaultRoots,
): Promise<() => Promise<void>> {
  if (!acquireLease("watch", WATCH_LEASE_TTL_MS))
    throw new Error(
      "Another Relay collector is already watching these sources.",
    );
  const renewTimer = setInterval(
    () => acquireLease("watch", WATCH_LEASE_TTL_MS),
    WATCH_LEASE_RENEW_MS,
  );
  renewTimer.unref?.();
  let watcher: ReturnType<typeof chokidar.watch> | undefined;
  try {
    const capabilityLookups = buildCapabilityLookups(
      await getAgentInventories({ kind: "global" }),
    );
    const initializedWatcher = chokidar.watch(
      roots.map((root) => root.path),
      {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
      },
    );
    watcher = initializedWatcher;
    const syncChanged = async (filePath: string): Promise<void> => {
      if (!filePath.endsWith(".jsonl")) return;
      const adapter = adapterForPath(filePath, roots);
      try {
        await syncFile(adapter, filePath, false, {
          capabilities: capabilityLookups[adapter.provider],
        });
      } catch (error) {
        recordSyncError(
          adapter.provider,
          filePath,
          "read_error",
          error instanceof Error ? error.message : "Unknown sync error",
        );
      }
    };
    initializedWatcher.on("add", syncChanged);
    initializedWatcher.on("change", syncChanged);
    await new Promise<void>((resolve) =>
      initializedWatcher.once("ready", () => resolve()),
    );
    return async () => {
      clearInterval(renewTimer);
      releaseLease("watch");
      await initializedWatcher.close();
    };
  } catch (error) {
    clearInterval(renewTimer);
    releaseLease("watch");
    try {
      await watcher?.close();
    } catch {
      // Preserve the initialization failure after best-effort cleanup.
    }
    throw error;
  }
}

function adapterForPath(
  filePath: string,
  roots: SourceRoot[] = defaultRoots,
): ProviderAdapter {
  const root = roots.find(
    (candidate) =>
      filePath === candidate.path ||
      filePath.startsWith(candidate.path + path.sep),
  );
  const match: AgentProvider =
    root?.provider ??
    (filePath.includes("/.codex/")
      ? "codex"
      : filePath.includes("/.claude/")
        ? "claude"
        : filePath.includes("/.zcode/")
          ? "zcode"
          : "pi");
  return adapters.find((adapter) => adapter.provider === match) ?? piAdapter;
}
