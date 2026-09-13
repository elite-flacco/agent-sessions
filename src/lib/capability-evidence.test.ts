import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

let directory: string;
let sqlite: (typeof import("@/db/client"))["sqlite"];
let getInsights: (typeof import("./queries"))["getInsights"];
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "capability-evidence-"));
  vi.stubEnv("AGENTARIUM_DATABASE_PATH", path.join(directory, "test.db"));
  vi.resetModules();
  ({ sqlite } = await import("@/db/client"));
  ({ getInsights } = await import("./queries"));
});
afterAll(async () => {
  sqlite.close();
  vi.unstubAllEnvs();
  await fs.rm(directory, { recursive: true, force: true });
});
it("folds distinct tool evidence within the selected range without changing usage counts", () => {
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 40 * 86400000).toISOString();
  sqlite
    .prepare(
      `INSERT INTO sessions (external_id, provider, title, status, started_at, updated_at)
    VALUES ('evidence', 'codex', 'Evidence', 'completed', ?, ?)`,
    )
    .run(now, now);
  const insert = sqlite.prepare(`INSERT INTO session_capability_usage
    (session_id, external_id, provider, kind, capability_name, occurred_at, tool_name)
    VALUES (1, ?, 'codex', 'mcp', 'codex_apps', ?, ?)`);
  insert.run("a", now, "gmail_read_email");
  insert.run("b", now, "gmail_read_email");
  insert.run("c", now, null);
  insert.run("d", old, "github_fetch_pr");
  expect(getInsights("7d", []).capabilities.used[0]).toMatchObject({
    name: "codex_apps",
    invocations: 3,
    sessionCount: 1,
    toolNames: ["gmail_read_email"],
  });
  expect(getInsights("all", []).capabilities.used[0]).toMatchObject({
    invocations: 4,
    toolNames: ["github_fetch_pr", "gmail_read_email"],
  });
  sqlite
    .prepare(
      "UPDATE session_capability_usage SET plugin_id = ? WHERE external_id IN ('a', 'b')",
    )
    .run("future-service@market");
  sqlite
    .prepare(
      "UPDATE session_capability_usage SET plugin_id = ? WHERE external_id = 'd'",
    )
    .run("old-service@market");
  const inventories = [
    {
      provider: "codex" as const,
      scope: "global" as const,
      warnings: [],
      capabilities: [
        {
          id: "plugin",
          name: "future-service@market",
          kind: "plugin" as const,
          status: "installed" as const,
          packaging: "plugin" as const,
          origin: "marketplace" as const,
          displayName: "Future Service",
          description: "Read future data",
        },
      ],
    },
  ];
  expect(getInsights("7d", inventories).capabilities.used[0]).toMatchObject({
    name: "codex_apps",
    invocations: 3,
    observedPlugins: [
      {
        id: "future-service@market",
        name: "Future Service",
        description: "Read future data",
      },
    ],
  });
  expect(
    getInsights("all", inventories).capabilities.used[0].observedPlugins,
  ).toEqual([
    {
      id: "future-service@market",
      name: "Future Service",
      description: "Read future data",
    },
    { id: "old-service@market", name: "old-service@market" },
  ]);
  expect(getInsights("7d", []).capabilities.used[0].observedPlugins).toEqual([
    { id: "future-service@market", name: "future-service@market" },
  ]);
});
