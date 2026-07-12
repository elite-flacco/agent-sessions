import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProviderAdapter } from "@/lib/types";

let directory = "";
let sqlite: (typeof import("@/db/client"))["sqlite"];
let collector: typeof import("./index");
let lock: typeof import("./lock");
let claudeAdapter: ProviderAdapter;

beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "relay-collector-"));
  process.env.RELAY_DATABASE_PATH = path.join(directory, "relay.db");
  vi.resetModules();
  ({ sqlite } = await import("@/db/client"));
  collector = await import("./index");
  lock = await import("./lock");
  ({ claudeAdapter } = await import("./adapters/claude"));
});

afterAll(async () => {
  sqlite.close();
  delete process.env.RELAY_DATABASE_PATH;
  await fs.rm(directory, { recursive: true, force: true });
});

function claudeRow(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    type: "user",
    sessionId: "watched-1",
    timestamp: "2026-07-11T10:00:00Z",
    cwd: "/work/relay",
    message: { role: "user", content: "Watch this session" },
    ...overrides,
  });
}

async function until(
  condition: () => boolean,
  timeoutMs = 8_000,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs)
      throw new Error("Condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function sessionCount(externalId: string): number {
  return (
    sqlite
      .prepare("SELECT COUNT(*) count FROM sessions WHERE external_id = ?")
      .get(externalId) as { count: number }
  ).count;
}

describe("collector sync", () => {
  it("shares one run across concurrent sync requests and re-imports without duplicates", async () => {
    const filePath = path.join(directory, "concurrent.jsonl");
    await fs.writeFile(
      filePath,
      claudeRow({ sessionId: "concurrent-1", uuid: "u1" }),
    );
    let parses = 0;
    const adapter: ProviderAdapter = {
      provider: "claude",
      discover: async () => [filePath],
      parse: (target) => {
        parses += 1;
        return claudeAdapter.parse(target);
      },
    };
    const [first, second] = await Promise.all([
      collector.syncAll({ adapters: [adapter] }),
      collector.syncAll({ adapters: [adapter] }),
    ]);
    expect(first).toBe(second);
    expect(parses).toBe(1);
    expect(first.imported).toBe(1);
    expect(sessionCount("concurrent-1")).toBe(1);

    const unchanged = await collector.syncAll({ adapters: [adapter] });
    expect(unchanged).toMatchObject({ imported: 0, skipped: 1 });

    await fs.appendFile(
      filePath,
      `\n${claudeRow({ sessionId: "concurrent-1", uuid: "u2", type: "result", timestamp: "2026-07-11T10:05:00Z" })}`,
    );
    const reimported = await collector.syncAll({ adapters: [adapter] });
    expect(reimported.imported).toBe(1);
    expect(sessionCount("concurrent-1")).toBe(1);
    expect(
      (
        sqlite
          .prepare("SELECT status FROM sessions WHERE external_id = ?")
          .get("concurrent-1") as { status: string }
      ).status,
    ).toBe("completed");
  });

  it("skips scanning while another process holds the sync lease", async () => {
    expect(lock.acquireLease("sync", 60_000, "other-process")).toBe(true);
    const result = await collector.syncAll({ adapters: [] });
    expect(result.locked).toBe(true);
    lock.releaseLease("sync", "other-process");
    const unlocked = await collector.syncAll({ adapters: [] });
    expect(unlocked.locked).toBe(false);
  });

  it("takes over an expired lease from a dead process", async () => {
    sqlite
      .prepare(
        "INSERT OR REPLACE INTO collector_leases (name, owner, acquired_at, expires_at) VALUES ('sync', 'dead', ?, ?)",
      )
      .run(
        new Date(Date.now() - 120_000).toISOString(),
        new Date(Date.now() - 60_000).toISOString(),
      );
    const result = await collector.syncAll({ adapters: [] });
    expect(result.locked).toBe(false);
  });

  it("records per-adapter scan state", async () => {
    const scan = sqlite
      .prepare("SELECT * FROM adapter_scans WHERE provider = 'claude'")
      .get() as { sources: number } | undefined;
    expect(scan).toBeDefined();
    expect(scan?.sources).toBeGreaterThanOrEqual(1);
  });

  it("clears sync errors once a source parses cleanly again", async () => {
    const filePath = path.join(directory, "recovers.jsonl");
    await fs.writeFile(filePath, "not json at all");
    const adapter: ProviderAdapter = {
      ...claudeAdapter,
      discover: async () => [filePath],
    };
    await collector.syncAll({ adapters: [adapter] });
    const failed = sqlite
      .prepare("SELECT COUNT(*) count FROM sync_errors WHERE source_path = ?")
      .get(filePath) as { count: number };
    expect(failed.count).toBe(1);

    await fs.writeFile(
      filePath,
      claudeRow({ sessionId: "recovered-1", uuid: "u1" }),
    );
    await collector.syncAll({ adapters: [adapter] });
    const recovered = sqlite
      .prepare("SELECT COUNT(*) count FROM sync_errors WHERE source_path = ?")
      .get(filePath) as { count: number };
    expect(recovered.count).toBe(0);
    expect(sessionCount("recovered-1")).toBe(1);
  });
});

describe("collector watcher", () => {
  it("ingests newly created and appended session files", async () => {
    const root = path.join(directory, "watched");
    await fs.mkdir(root, { recursive: true });
    const close = await collector.watchSources([
      { path: root, provider: "claude" },
    ]);
    try {
      const filePath = path.join(root, "watched-session.jsonl");
      await fs.writeFile(filePath, claudeRow({ uuid: "u1" }));
      await until(() => sessionCount("watched-1") === 1);

      await fs.appendFile(
        filePath,
        `\n${claudeRow({ uuid: "u2", type: "result", timestamp: "2026-07-11T10:09:00Z" })}`,
      );
      await until(
        () =>
          (
            sqlite
              .prepare("SELECT status FROM sessions WHERE external_id = ?")
              .get("watched-1") as { status: string } | undefined
          )?.status === "completed",
      );
    } finally {
      await close();
    }
  }, 20_000);

  it("refuses to start while another live watcher holds the lease", async () => {
    expect(lock.acquireLease("watch", 60_000, "other-watcher")).toBe(true);
    await expect(collector.watchSources([])).rejects.toThrow(
      /already watching/,
    );
    lock.releaseLease("watch", "other-watcher");
  });
});
