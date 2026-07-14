import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import chokidar from "chokidar";
import type {
  AgentProvider,
  NormalizedSession,
  ProviderAdapter,
} from "@/lib/types";
import { sqlite } from "@/db/client";
import { claudeAdapter } from "./adapters/claude";
import { codexAdapter } from "./adapters/codex";
import { piAdapter } from "./adapters/pi";
import { zcodeAdapter } from "./adapters/zcode";
import { acquireLease, releaseLease } from "./lock";
import { homePath } from "./utils";

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
const NORMALIZATION_VERSION = "5";

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
        external_id, source_path, provider, title, summary, repository, cwd, branch, status, started_at, ended_at,
        updated_at, files_changed, additions, deletions, input_tokens, output_tokens, cached_tokens, model, estimated_cost_usd
      ) VALUES (
        @externalId, @sourcePath, @provider, @title, @summary, @repository, @cwd, @branch, @status, @startedAt, @endedAt,
        @updatedAt, @filesChanged, @additions, @deletions, @inputTokens, @outputTokens, @cachedTokens, @model, @estimatedCostUsd
      ) ON CONFLICT(provider, external_id) DO UPDATE SET
        source_path=excluded.source_path, title=excluded.title, summary=excluded.summary, repository=COALESCE(excluded.repository, sessions.repository),
        cwd=COALESCE(excluded.cwd, sessions.cwd), branch=COALESCE(excluded.branch, sessions.branch), status=excluded.status,
        started_at=MIN(excluded.started_at, sessions.started_at), ended_at=COALESCE(excluded.ended_at, sessions.ended_at),
        updated_at=MAX(excluded.updated_at, sessions.updated_at), input_tokens=COALESCE(excluded.input_tokens, sessions.input_tokens),
        output_tokens=COALESCE(excluded.output_tokens, sessions.output_tokens), cached_tokens=COALESCE(excluded.cached_tokens, sessions.cached_tokens),
        model=COALESCE(excluded.model, sessions.model), estimated_cost_usd=COALESCE(excluded.estimated_cost_usd, sessions.estimated_cost_usd)`,
      )
      .run({
        ...session,
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
