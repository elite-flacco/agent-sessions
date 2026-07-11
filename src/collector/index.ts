import crypto from "node:crypto";
import fs from "node:fs/promises";
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
import { homePath } from "./utils";

export const adapters: ProviderAdapter[] = [
  codexAdapter,
  claudeAdapter,
  zcodeAdapter,
  piAdapter,
];

function fingerprint(size: number, modifiedAt: number): string {
  return crypto
    .createHash("sha1")
    .update(`${size}:${modifiedAt}`)
    .digest("hex");
}

function persistSession(session: NormalizedSession): void {
  const write = sqlite.transaction(() => {
    sqlite
      .prepare(
        `INSERT INTO sessions (
        external_id, provider, title, summary, repository, cwd, branch, status, started_at, ended_at,
        updated_at, files_changed, additions, deletions, input_tokens, output_tokens, cached_tokens, model, estimated_cost_usd
      ) VALUES (
        @externalId, @provider, @title, @summary, @repository, @cwd, @branch, @status, @startedAt, @endedAt,
        @updatedAt, @filesChanged, @additions, @deletions, @inputTokens, @outputTokens, @cachedTokens, @model, @estimatedCostUsd
      ) ON CONFLICT(provider, external_id) DO UPDATE SET
        title=excluded.title, summary=excluded.summary, repository=COALESCE(excluded.repository, sessions.repository),
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
        inputTokens: session.usage?.inputTokens ?? null,
        outputTokens: session.usage?.outputTokens ?? null,
        cachedTokens: session.usage?.cachedTokens ?? null,
        model: session.usage?.model ?? null,
        estimatedCostUsd: session.usage?.estimatedCostUsd ?? null,
      });

    const row = sqlite
      .prepare("SELECT id FROM sessions WHERE provider = ? AND external_id = ?")
      .get(session.provider, session.externalId) as { id: number };
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
  const errorStatement = sqlite.prepare(
    "INSERT INTO sync_errors (provider, source_path, code, message, occurred_at) VALUES (?, ?, ?, ?, ?)",
  );
  for (const error of result.errors)
    errorStatement.run(
      error.provider,
      error.sourcePath,
      error.code,
      error.message.slice(0, 500),
      error.occurredAt,
    );
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

export async function syncAll(options: { force?: boolean } = {}): Promise<{
  imported: number;
  skipped: number;
  errors: number;
  sources: number;
}> {
  const totals = { imported: 0, skipped: 0, errors: 0, sources: 0 };
  for (const adapter of adapters) {
    const paths = await adapter.discover();
    totals.sources += paths.length;
    for (const filePath of paths) {
      try {
        const result = await syncFile(adapter, filePath, options.force);
        totals.imported += result.imported;
        totals.skipped += result.skipped;
        totals.errors += result.errors;
      } catch (error) {
        totals.errors += 1;
        sqlite
          .prepare(
            "INSERT INTO sync_errors (provider, source_path, code, message, occurred_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run(
            adapter.provider,
            filePath,
            "read_error",
            error instanceof Error
              ? error.message.slice(0, 500)
              : "Unknown sync error",
            new Date().toISOString(),
          );
      }
    }
  }
  return totals;
}

export async function watchSources(): Promise<() => Promise<void>> {
  const watcher = chokidar.watch(
    [
      homePath(".codex", "sessions"),
      homePath(".claude", "projects"),
      homePath(".zcode", "cli", "rollout"),
      homePath(".zcode", "cli", "agents"),
      homePath(".pi", "agent", "sessions"),
    ],
    {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    },
  );
  const syncChanged = async (filePath: string): Promise<void> => {
    if (!filePath.endsWith(".jsonl")) return;
    await syncFile(adapterForPath(filePath), filePath);
  };
  watcher.on("add", syncChanged);
  watcher.on("change", syncChanged);
  return () => watcher.close();
}

function adapterForPath(filePath: string): ProviderAdapter {
  const match: AgentProvider = filePath.includes("/.codex/")
    ? "codex"
    : filePath.includes("/.claude/")
      ? "claude"
      : filePath.includes("/.zcode/")
        ? "zcode"
        : "pi";
  return adapters.find((adapter) => adapter.provider === match) ?? piAdapter;
}
