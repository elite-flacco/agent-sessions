import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import chokidar from "chokidar";
import type {
  AgentProvider,
  NormalizedSession,
  ProviderAdapter,
} from "@/lib/types";
import { getCodexThreadTitle } from "@/lib/codex-db";
import { sqlite } from "@/db/client";
import {
  getZcodeSessionMetadata,
  listZcodeSessionMetadata,
  readZcodeSessionMessages,
  type ZcodeStoredMessage,
} from "@/lib/zcode-db";
import { claudeAdapter } from "./adapters/claude";
import { codexAdapter } from "./adapters/codex";
import { piAdapter } from "./adapters/pi";
import { sessionSummary } from "./adapters/shared";
import { zcodeAdapter } from "./adapters/zcode";
import { acquireLease, releaseLease } from "./lock";
import {
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
const NORMALIZATION_VERSION = "9";

function fingerprint(size: number, modifiedAt: number): string {
  return crypto
    .createHash("sha1")
    .update(`${NORMALIZATION_VERSION}:${size}:${modifiedAt}`)
    .digest("hex");
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
        title, summary, repository, cwd, branch, status, started_at, ended_at,
        updated_at, files_changed, additions, deletions, input_tokens, output_tokens, cached_tokens, model, estimated_cost_usd
      ) VALUES (
        @externalId, @sourcePath, @provider, @parentExternalId, @sessionKind, @agentLabel, @agentDepth,
        @title, @summary, @repository, @cwd, @branch, @status, @startedAt, @endedAt,
        @updatedAt, @filesChanged, @additions, @deletions, @inputTokens, @outputTokens, @cachedTokens, @model, @estimatedCostUsd
      ) ON CONFLICT(provider, external_id) DO UPDATE SET
        source_path=COALESCE(excluded.source_path, sessions.source_path), parent_external_id=excluded.parent_external_id,
        session_kind=excluded.session_kind, agent_label=excluded.agent_label, agent_depth=excluded.agent_depth,
        title=excluded.title, summary=excluded.summary, repository=COALESCE(excluded.repository, sessions.repository),
        cwd=COALESCE(excluded.cwd, sessions.cwd), branch=COALESCE(excluded.branch, sessions.branch), status=excluded.status,
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

function zcodeStoredStatus(
  messages: ZcodeStoredMessage[],
  updatedAt: string,
): "completed" | "running" | "incomplete" | "interrupted" | "needs_attention" {
  for (const message of [...messages].reverse()) {
    for (const part of [...message.parts].reverse()) {
      const data = record(part.data);
      const state = record(data?.state);
      if (
        data?.type === "tool" &&
        data.tool === "AskUserQuestion" &&
        state?.status === "running"
      )
        return "needs_attention";
    }
  }
  for (const message of [...messages].reverse()) {
    const data = record(message.data);
    if (!data) continue;
    // An explicit cancel is an abort marker, not a failure.
    if (data.error)
      return /cancel/i.test(JSON.stringify(data.error))
        ? "interrupted"
        : "needs_attention";
    if (data.role === "assistant" && record(data.time)?.completed)
      return "completed";
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
      if (title) update.run(safeTitle(title, session.title), session.id);
    }
  });
  write();
}

function reconcileZcodeMetadata(): void {
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
         session_kind = ?, agent_depth = ?, status = ?, ended_at = ?, updated_at = ?
     WHERE id = ?`,
  );
  const write = sqlite.transaction(() => {
    for (const session of sessions) {
      const metadata = getZcodeSessionMetadata(session.externalId);
      if (!metadata) continue;
      const cwd = metadata.directory ?? session.cwd ?? undefined;
      const messages = readZcodeSessionMessages(session.externalId) ?? [];
      const updatedAt =
        metadata.timeUpdated === undefined
          ? undefined
          : new Date(metadata.timeUpdated).toISOString();
      const storedStatus =
        messages.length && updatedAt
          ? zcodeStoredStatus(messages, updatedAt)
          : undefined;
      const status =
        session.status === "interrupted" &&
        (storedStatus === "running" || storedStatus === "incomplete")
          ? session.status
          : (storedStatus ?? session.status);
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
        status === "completed" || status === "needs_attention"
          ? (updatedAt ?? null)
          : null,
        freshestUpdatedAt,
        session.id,
      );
    }
  });
  write();

  const allMetadata = listZcodeSessionMetadata() ?? [];
  const existingIds = new Set(sessions.map((session) => session.externalId));
  for (const metadata of allMetadata) {
    if (
      !metadata.id ||
      existingIds.has(metadata.id) ||
      metadata.timeCreated === undefined ||
      metadata.timeUpdated === undefined
    )
      continue;
    const startedAt = new Date(metadata.timeCreated).toISOString();
    const updatedAt = new Date(metadata.timeUpdated).toISOString();
    const messages = readZcodeSessionMessages(metadata.id) ?? [];
    const status = zcodeStoredStatus(messages, updatedAt);
    const title = zcodeTitle(
      safeTitle(metadata.title, "Zcode coding session"),
      metadata.taskType,
      messages,
    );
    persistSession({
      externalId: metadata.id,
      provider: "zcode",
      parentExternalId: metadata.parentId,
      sessionKind: metadata.taskType === "subagent_child" ? "subagent" : "main",
      agentDepth: metadata.parentId ? 1 : 0,
      title,
      summary: sessionSummary("zcode", metadata.directory),
      repository: repositoryFromCwd(metadata.directory),
      cwd: metadata.directory,
      status,
      startedAt,
      endedAt:
        status === "completed" || status === "needs_attention"
          ? updatedAt
          : undefined,
      updatedAt,
      usage: [],
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
}

async function syncFile(
  adapter: ProviderAdapter,
  filePath: string,
  force = false,
): Promise<{ imported: number; skipped: number; errors: number }> {
  const stat = await fs.stat(filePath);
  const currentFingerprint = fingerprint(stat.size, stat.mtimeMs);
  const existing = sqlite
    .prepare("SELECT fingerprint FROM ingestion_sources WHERE path = ?")
    .get(filePath) as { fingerprint: string } | undefined;
  if (!force && existing?.fingerprint === currentFingerprint)
    return { imported: 0, skipped: 1, errors: 0 };

  const result = await adapter.parse(filePath);
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
    sqlite
      .prepare("DELETE FROM sync_errors WHERE occurred_at < ?")
      .run(new Date(Date.now() - SYNC_ERROR_RETENTION_MS).toISOString());
    for (const adapter of options.adapters ?? adapters) {
      const scan = { sources: 0, imported: 0, errors: 0 };
      const paths = await adapter.discover();
      scan.sources = paths.length;
      for (const filePath of paths) {
        try {
          const result = await syncFile(adapter, filePath, options.force);
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
    reconcileZcodeMetadata();
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
  const watcher = chokidar.watch(
    roots.map((root) => root.path),
    {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    },
  );
  const syncChanged = async (filePath: string): Promise<void> => {
    if (!filePath.endsWith(".jsonl")) return;
    const adapter = adapterForPath(filePath, roots);
    try {
      await syncFile(adapter, filePath);
    } catch (error) {
      recordSyncError(
        adapter.provider,
        filePath,
        "read_error",
        error instanceof Error ? error.message : "Unknown sync error",
      );
    }
  };
  watcher.on("add", syncChanged);
  watcher.on("change", syncChanged);
  await new Promise<void>((resolve) => watcher.once("ready", () => resolve()));
  return async () => {
    clearInterval(renewTimer);
    releaseLease("watch");
    await watcher.close();
  };
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
