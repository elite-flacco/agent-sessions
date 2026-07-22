# Capability Usage Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `/insights` with privacy-safe skill and MCP usage rankings plus active installed capabilities with no observed use.

**Architecture:** Provider adapters normalize allowlisted capability identifiers into a dedicated `session_capability_usage` table during collection. The Insights server page supplies live inventories to `getInsights()`, which combines persisted observations with current active installations and provider coverage; a focused client card renders URL-backed 7/30-day rankings and unused states.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, better-sqlite3, Drizzle ORM/migrations, Vitest, Testing Library, semantic CSS in `src/app/globals.css`.

## Global Constraints

- Scope is skills and MCPs only; plugin activity and attribution remain deferred.
- Default capability range is `30d`; supported URL values are exactly `7d` and `30d`.
- Persist only session, provider, kind, canonical capability name, stable event identifier, and timestamp.
- Never persist prompts, command strings, tool arguments, tool results, MCP payloads, skill contents, credentials, or configuration.
- Claude/Zcode native `Skill` calls are authoritative; Codex/Pi skill usage requires an exact match to a known active inventory `SKILL.md` path.
- MCP tool calls aggregate under their server name, not individual operation names.
- Disabled and unavailable inventory entries never appear as unused.
- Partial or unavailable provider coverage never produces a definitive unused claim.
- New UI uses semantic tokens and component classes from `src/app/globals.css`; no raw Tailwind palette colors, arbitrary values, inline styles, or `dark:` variants.
- Browser verification covers desktop and 390px widths, interactions, overflow, and console errors.
- The repository Definition of Done in `docs/superpowers/plan-dod.md` applies unchanged.
- Execution starts in an isolated worktree on branch `codex/feat/capability-usage-insights` created with `superpowers:using-git-worktrees`.

## File map

- `src/lib/types.ts` — public normalized capability types and adapter parse context.
- `src/collector/capabilities.ts` — safe identifier validation, inventory lookup construction, MCP normalization, and exact-path skill-read matching.
- `src/collector/capabilities.test.ts` — focused privacy and normalization tests.
- `src/collector/adapters/shared.ts` — carries adapter capability output into `NormalizedSession` without the activity-event cap.
- `src/collector/adapters/{codex,claude,zcode,pi}.ts` — provider-specific evidence extraction.
- `src/collector/adapters/adapters.test.ts` — end-to-end adapter fixtures proving output and non-retention.
- `src/db/schema.ts`, `src/db/client.ts`, `src/db/migrate.ts`, `drizzle/` — table, bootstrap parity, migration, and legacy baseline handling.
- `src/db/migrate.test.ts` — verifies a hierarchy-aware legacy database still receives the new table.
- `src/collector/index.ts` — transactionally replaces capability rows, injects one lookup per run, bumps normalization, and reconciles Zcode.
- `src/collector/collector.test.ts` — idempotence, replacement, cascade, watcher context, and database-only behavior.
- `src/lib/zcode-db.ts` — safe read-only Zcode tool-usage and availability APIs.
- `src/lib/queries.ts`, `src/lib/insights.test.ts` — capability rankings, unused states, range parsing, and coverage.
- `src/app/insights/page.tsx` — parses URL range, discovers live inventories, and supplies query inputs.
- `src/components/capability-usage-card.tsx` — focused capability analytics UI.
- `src/components/capability-usage-card.test.tsx` — range, ranking, unused, disclosure, and coverage states.
- `src/components/insights-view.tsx`, `src/app/globals.css` — card integration and semantic responsive styles.
- `README.md`, `AGENTS.md`, `CLAUDE.md` — user-facing and architectural documentation.

---

### Task 1: Capability types, inventory lookup, and privacy-safe normalizers

**Files:**

- Create: `src/collector/capabilities.ts`
- Create: `src/collector/capabilities.test.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/collector/adapters/shared.ts`

**Interfaces:**

- Produces `CapabilityUsageKind`, `CapabilityUsage`, `CapabilityLookup`, and `AdapterParseContext` in `src/lib/types.ts`.
- Produces `buildCapabilityLookups(inventories)`, `explicitSkillUsage(...)`, `mcpUsage(...)`, and `matchedSkillReads(...)` in `src/collector/capabilities.ts`.
- `ProviderAdapter.parse(filePath, context?)` accepts one provider-specific lookup; existing callers may omit it.
- `JsonlStrategy.capabilityUsage?(rows)` returns uncapped, allowlisted capability observations.

- [ ] **Step 1: Write failing tests for active inventory lookup and safe identifiers**

Create `src/collector/capabilities.test.ts` with fixtures that include active, disabled, and unavailable capabilities:

```ts
import { describe, expect, it } from "vitest";
import type { AgentInventory } from "@/lib/agent-inventory";
import {
  buildCapabilityLookups,
  explicitSkillUsage,
  matchedSkillReads,
  mcpUsage,
} from "./capabilities";

const inventories: AgentInventory[] = [
  {
    provider: "codex",
    scope: "global",
    warnings: [],
    capabilities: [
      {
        id: "codex:skill:frontend-rules",
        name: "frontend-rules",
        kind: "skill",
        status: "enabled",
        packaging: "standalone",
        origin: "personal",
        sourcePath: "/safe/links/frontend-rules",
        canonicalSourcePath: "/safe/source/frontend-rules",
      },
      {
        id: "codex:skill:disabled",
        name: "disabled-skill",
        kind: "skill",
        status: "disabled",
        packaging: "standalone",
        origin: "personal",
        canonicalSourcePath: "/safe/source/disabled-skill",
      },
      {
        id: "codex:mcp:github",
        name: "github",
        kind: "mcp",
        status: "enabled",
        packaging: "plugin",
        origin: "marketplace",
      },
    ],
  },
];

describe("capability normalization", () => {
  it("builds aliases only for active inventory capabilities", () => {
    const lookup = buildCapabilityLookups(inventories).codex;
    expect(lookup.skillFiles.get("/safe/source/frontend-rules/SKILL.md")).toBe(
      "frontend-rules",
    );
    expect(lookup.skillFiles.get("/safe/links/frontend-rules/SKILL.md")).toBe(
      "frontend-rules",
    );
    expect([...lookup.skillFiles.values()]).not.toContain("disabled-skill");
    expect(lookup.mcpNames.get("github")).toBe("github");
  });

  it("accepts a native skill name without retaining other input", () => {
    expect(
      explicitSkillUsage("skill-1", "frontend-rules", "2026-07-22T10:00:00Z"),
    ).toEqual({
      externalId: "skill:skill-1",
      kind: "skill",
      name: "frontend-rules",
      occurredAt: "2026-07-22T10:00:00Z",
    });
    expect(
      explicitSkillUsage("skill-2", "/tmp/secret", "2026-07-22T10:00:00Z"),
    ).toBeUndefined();
  });

  it("rolls namespaced calls up to their MCP server", () => {
    expect(
      mcpUsage({
        externalId: "call-1",
        toolName: "mcp__github__search_prs",
        occurredAt: "2026-07-22T10:00:00Z",
      }),
    ).toMatchObject({ kind: "mcp", name: "github" });
    expect(
      mcpUsage({
        externalId: "call-2",
        toolName: "_search_prs",
        namespace: "mcp__codex_apps__github",
        occurredAt: "2026-07-22T10:00:00Z",
      }),
    ).toMatchObject({ kind: "mcp", name: "github" });
  });

  it("counts only read-like calls containing an exact inventory skill file", () => {
    const lookup = buildCapabilityLookups(inventories).codex;
    expect(
      matchedSkillReads({
        externalId: "read-1",
        toolName: "exec_command",
        input: { cmd: "sed -n '1,240p' /safe/links/frontend-rules/SKILL.md" },
        occurredAt: "2026-07-22T10:00:00Z",
        lookup,
      }),
    ).toEqual([
      {
        externalId: "skill-read:read-1:frontend-rules",
        kind: "skill",
        name: "frontend-rules",
        occurredAt: "2026-07-22T10:00:00Z",
      },
    ]);
    expect(
      matchedSkillReads({
        externalId: "write-1",
        toolName: "apply_patch",
        input: "*** Update File: /safe/source/frontend-rules/SKILL.md",
        occurredAt: "2026-07-22T10:00:00Z",
        lookup,
      }),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the missing module failure**

Run: `npx vitest run src/collector/capabilities.test.ts`

Expected: FAIL because `src/collector/capabilities.ts` does not exist.

- [ ] **Step 3: Add the normalized types and optional adapter context**

Add to `src/lib/types.ts`:

```ts
export type CapabilityUsageKind = "skill" | "mcp";

export interface CapabilityUsage {
  externalId: string;
  kind: CapabilityUsageKind;
  name: string;
  occurredAt: string;
}

export interface CapabilityLookup {
  skillFiles: ReadonlyMap<string, string>;
  mcpNames: ReadonlyMap<string, string>;
}

export interface AdapterParseContext {
  capabilities?: CapabilityLookup;
}
```

Add `capabilityUsage: CapabilityUsage[]` to `NormalizedSession`, and change the adapter signature to:

```ts
parse(filePath: string, context?: AdapterParseContext): Promise<ParseResult>;
```

Add to `JsonlStrategy` in `src/collector/adapters/shared.ts`:

```ts
capabilityUsage?(rows: Record<string, unknown>[]): CapabilityUsage[];
```

Set the normalized session field without applying the 40-event cap:

```ts
const capabilityUsage = strategy.capabilityUsage?.(rows) ?? [];

// Inside the NormalizedSession literal:
capabilityUsage,
```

- [ ] **Step 4: Implement the safe helper boundary**

Create `src/collector/capabilities.ts`. Use `canonicalCapabilityName` from the existing inventory normalizer and implement these rules:

```ts
const ACTIVE_STATUSES = new Set(["enabled", "installed"]);
const SAFE_NAME = /^[\p{L}\p{N}][\p{L}\p{N}_.:@ -]{0,159}$/u;
const READ_LIKE_TOOL = /^(read|exec|exec_command|bash)$/i;
const READ_MARKER =
  /\b(cat|sed|head|tail|less|bat|rg|grep|readFile|Get-Content)\b/i;

function safeName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  return SAFE_NAME.test(name) && !name.includes("/") && !name.includes("\\")
    ? name
    : undefined;
}

function skillFile(path: string): string {
  return path.endsWith(".md") ? path : `${path}/SKILL.md`;
}
```

`buildCapabilityLookups()` must add both `sourcePath` and `canonicalSourcePath` aliases for active skills, use canonical lowercase keys for MCP matching, and return empty lookups for missing providers. `matchedSkillReads()` may recursively inspect in-memory string leaves, but it must return only `CapabilityUsage` objects and must require either a native `read` tool or a read marker for shell/exec tools. Deduplicate matched skill names within one call.

- [ ] **Step 5: Run the focused tests and adjacent adapter tests**

Run: `npx vitest run src/collector/capabilities.test.ts src/collector/adapters/adapters.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the normalization boundary**

```bash
git add src/lib/types.ts src/collector/capabilities.ts src/collector/capabilities.test.ts src/collector/adapters/shared.ts
git commit -m "✨ feat(collector): add capability usage normalization boundary"
```

---

### Task 2: Provider adapter extraction for Claude, Codex, Pi, and rollout Zcode

**Files:**

- Modify: `src/collector/adapters/claude.ts`
- Modify: `src/collector/adapters/codex.ts`
- Modify: `src/collector/adapters/pi.ts`
- Modify: `src/collector/adapters/zcode.ts`
- Modify: `src/collector/adapters/adapters.test.ts`

**Interfaces:**

- Consumes the helpers and `AdapterParseContext` from Task 1.
- Produces uncapped `session.capabilityUsage` observations; it does not change generic `session.events` behavior.

- [ ] **Step 1: Add failing Claude extraction and privacy tests**

Append an adapter test with a native skill call and MCP call:

```ts
it("normalizes Claude skill and MCP calls without retaining arguments", async () => {
  const result = await parse(claudeAdapter, [
    {
      type: "user",
      uuid: "u-cap",
      sessionId: "claude-capabilities",
      timestamp: "2026-07-22T10:00:00Z",
      message: { role: "user", content: "Inspect capability use" },
    },
    {
      type: "assistant",
      uuid: "a-skill",
      sessionId: "claude-capabilities",
      timestamp: "2026-07-22T10:01:00Z",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "skill-call",
            name: "Skill",
            input: { skill: "frontend-rules", args: "SECRET_ARGS" },
          },
          {
            type: "tool_use",
            id: "mcp-call",
            name: "mcp__github__search_prs",
            input: { query: "SECRET_QUERY" },
          },
        ],
      },
    },
  ]);

  expect(result.sessions[0]?.capabilityUsage).toEqual([
    expect.objectContaining({ kind: "skill", name: "frontend-rules" }),
    expect.objectContaining({ kind: "mcp", name: "github" }),
  ]);
  expect(JSON.stringify(result.sessions[0]?.capabilityUsage)).not.toMatch(
    /SECRET_ARGS|SECRET_QUERY/,
  );
});
```

- [ ] **Step 2: Add failing Codex exact-path and namespace tests**

Update the local test `parse()` helper to accept an optional `AdapterParseContext`, then add a Codex fixture containing:

```ts
const lookup: CapabilityLookup = {
  skillFiles: new Map([
    ["/safe/links/frontend-rules/SKILL.md", "frontend-rules"],
    ["/safe/source/frontend-rules/SKILL.md", "frontend-rules"],
  ]),
  mcpNames: new Map([["github", "github"]]),
};
const result = await parse(
  codexAdapter,
  [
    {
      type: "session_meta",
      timestamp: "2026-07-22T10:00:00Z",
      payload: { id: "codex-capabilities", cwd: "/work/relay" },
    },
    {
      type: "response_item",
      timestamp: "2026-07-22T10:01:00Z",
      payload: {
        type: "function_call",
        call_id: "read-skill",
        name: "exec_command",
        arguments: JSON.stringify({
          cmd: "sed -n '1,240p' /safe/links/frontend-rules/SKILL.md",
        }),
      },
    },
    {
      type: "response_item",
      timestamp: "2026-07-22T10:02:00Z",
      payload: {
        type: "function_call",
        call_id: "github-call",
        namespace: "mcp__codex_apps__github",
        name: "_search_prs",
        arguments: "SECRET_MCP_ARGUMENTS",
      },
    },
  ],
  false,
  { capabilities: lookup },
);

expect(result.sessions[0]?.capabilityUsage).toEqual([
  expect.objectContaining({ kind: "skill", name: "frontend-rules" }),
  expect.objectContaining({ kind: "mcp", name: "github" }),
]);
expect(JSON.stringify(result.sessions[0]?.capabilityUsage)).not.toContain(
  "SECRET_MCP_ARGUMENTS",
);
```

Also include negative calls for an unmatched `/tmp/SKILL.md`, a plain developer-message catalog, and an `apply_patch` call touching the matched file; all must produce no skill event.

- [ ] **Step 3: Add failing Pi and Zcode rollout tests**

For Pi, use a `toolCall` block named `read` with `{ path: "/safe/links/frontend-rules/SKILL.md" }` plus a namespaced MCP call. For Zcode rollout/model message content, use a `Skill` tool block with `{ skill: "review-code-changes" }` and `mcp__openaiDeveloperDocs__search_openai_docs`. Assert exact normalized names and no retained inputs.

- [ ] **Step 4: Run the adapter tests and confirm capability assertions fail**

Run: `npx vitest run src/collector/adapters/adapters.test.ts`

Expected: FAIL because provider strategies do not yet define `capabilityUsage`.

- [ ] **Step 5: Implement provider-specific extraction**

Change each adapter's `parse` signature to `(filePath, context)` and add a `capabilityUsage` strategy. For every tool block/call:

```ts
const observed = [
  explicitSkillUsage(callId, explicitSkillName, occurredAt),
  mcpUsage({ externalId: callId, toolName, namespace, occurredAt }),
  ...matchedSkillReads({
    externalId: callId,
    toolName,
    input,
    occurredAt,
    lookup: context?.capabilities,
  }),
].filter((entry): entry is CapabilityUsage => entry !== undefined);
```

Use provider-native stable IDs in this order: call/tool ID, row UUID/ID, then `${rowIndex}-${blockIndex}`. Claude and Zcode use `explicitSkillUsage` only when the tool name is exactly `Skill`. Codex/Pi use `matchedSkillReads` and never derive skills from messages or catalogs.

- [ ] **Step 6: Verify provider extraction and privacy**

Run: `npx vitest run src/collector/capabilities.test.ts src/collector/adapters/adapters.test.ts`

Expected: PASS with no snapshot or assertion containing secret arguments.

- [ ] **Step 7: Commit provider extraction**

```bash
git add src/collector/adapters/claude.ts src/collector/adapters/codex.ts src/collector/adapters/pi.ts src/collector/adapters/zcode.ts src/collector/adapters/adapters.test.ts
git commit -m "✨ feat(collector): extract skill and MCP usage"
```

---

### Task 3: Capability schema, migration, transactional persistence, and run context

**Files:**

- Modify: `src/db/schema.ts`
- Modify: `src/db/client.ts`
- Modify: `src/db/migrate.ts`
- Create: `src/db/migrate.test.ts`
- Generate: `drizzle/0006_*.sql` and `drizzle/meta/*`
- Modify: `src/collector/index.ts`
- Modify: `src/collector/collector.test.ts`

**Interfaces:**

- Consumes `CapabilityUsage` and `buildCapabilityLookups()`.
- Produces the `session_capability_usage` table and transactional replacement through `persistSession()`.
- `syncFile(adapter, filePath, force, context)` passes one provider lookup to adapter parsing.
- Default full scans and watchers discover inventory once per run; explicitly injected test adapters receive an empty lookup unless the test supplies one.

- [ ] **Step 1: Add failing collector tests for replacement and cascade**

In `src/collector/collector.test.ts`, add a custom adapter whose first parse returns two capability rows and second parse returns one:

```ts
it("replaces capability usage idempotently and cascades with its session", async () => {
  const filePath = path.join(directory, "capability-usage.jsonl");
  await fs.writeFile(filePath, "{}\n");
  let pass = 0;
  const adapter: ProviderAdapter = {
    provider: "claude",
    discover: async () => [filePath],
    parse: async () => {
      pass += 1;
      return {
        errors: [],
        sessions: [
          {
            externalId: "capability-session",
            provider: "claude",
            title: "Capability session",
            status: "completed",
            startedAt: "2026-07-22T10:00:00Z",
            endedAt: "2026-07-22T10:02:00Z",
            updatedAt: "2026-07-22T10:02:00Z",
            usage: [],
            events: [],
            capabilityUsage:
              pass === 1
                ? [
                    {
                      externalId: "skill:1",
                      kind: "skill",
                      name: "frontend-rules",
                      occurredAt: "2026-07-22T10:01:00Z",
                    },
                    {
                      externalId: "mcp:1",
                      kind: "mcp",
                      name: "github",
                      occurredAt: "2026-07-22T10:01:30Z",
                    },
                  ]
                : [
                    {
                      externalId: "mcp:1",
                      kind: "mcp",
                      name: "github",
                      occurredAt: "2026-07-22T10:01:30Z",
                    },
                  ],
          },
        ],
      };
    },
  };

  await collector.syncAll({ adapters: [adapter], force: true });
  await collector.syncAll({ adapters: [adapter], force: true });
  expect(
    (
      sqlite
        .prepare("SELECT COUNT(*) count FROM session_capability_usage")
        .get() as { count: number }
    ).count,
  ).toBe(1);

  sqlite
    .prepare("DELETE FROM sessions WHERE external_id = ?")
    .run("capability-session");
  expect(
    (
      sqlite
        .prepare("SELECT COUNT(*) count FROM session_capability_usage")
        .get() as { count: number }
    ).count,
  ).toBe(0);
});
```

- [ ] **Step 2: Run the collector test and confirm the missing-table failure**

Run: `npx vitest run src/collector/collector.test.ts -t "replaces capability usage"`

Expected: FAIL with `no such table: session_capability_usage`.

- [ ] **Step 3: Add schema and bootstrap SQL**

Add this Drizzle table to `src/db/schema.ts`:

```ts
export const sessionCapabilityUsage = sqliteTable(
  "session_capability_usage",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    provider: text("provider").notNull(),
    kind: text("kind").notNull(),
    capabilityName: text("capability_name").notNull(),
    occurredAt: text("occurred_at").notNull(),
  },
  (table) => [
    uniqueIndex("capability_usage_session_external_idx").on(
      table.sessionId,
      table.externalId,
    ),
    index("capability_usage_kind_name_idx").on(
      table.kind,
      table.capabilityName,
    ),
    index("capability_usage_occurred_idx").on(table.occurredAt),
  ],
);
```

Mirror the table and all three indexes in the `src/db/client.ts` bootstrap SQL.

- [ ] **Step 4: Generate and inspect the migration**

Run: `npm run db:generate`

Expected: a new `drizzle/0006_*.sql` plus journal/snapshot updates containing only the new table and indexes.

Run: `rg -n "session_capability_usage|capability_usage_" drizzle/0006_*.sql drizzle/meta`

Expected: table plus unique/kind-name/timestamp indexes are present.

- [ ] **Step 5: Preserve legacy migration baselines**

In `src/db/migrate.ts`, detect the new table before choosing the baseline:

```ts
const hasCapabilityUsage = Boolean(
  sqlite
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session_capability_usage'",
    )
    .get(),
);

const baseline = hasCapabilityUsage
  ? migrations
  : hasSessionHierarchy
    ? migrations.slice(0, -1)
    : hasSourcePath
      ? migrations.slice(0, -2)
      : migrations.slice(0, -3);
```

This ensures a legacy hierarchy-aware database without the new table still runs migration `0006`.

- [ ] **Step 6: Add a migration regression test for existing hierarchy databases**

Create `src/db/migrate.test.ts`. Build a temporary SQLite database with the current `sessions` hierarchy columns but no migration journal and no `session_capability_usage` table, execute `src/db/migrate.ts` in a child process, then assert the table exists:

```ts
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("database migration baseline", () => {
  it("applies capability usage migration to a hierarchy-aware legacy database", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "relay-migrate-"),
    );
    directories.push(directory);
    const databasePath = path.join(directory, "relay.db");
    const database = new Database(databasePath);
    database.exec(`CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT NOT NULL,
      source_path TEXT,
      provider TEXT NOT NULL,
      parent_external_id TEXT,
      session_kind TEXT NOT NULL DEFAULT 'main',
      agent_label TEXT,
      agent_depth INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    database.close();

    execFileSync(process.execPath, ["--import", "tsx", "src/db/migrate.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, RELAY_DATABASE_PATH: databasePath },
      stdio: "pipe",
    });

    const migrated = new Database(databasePath, { readonly: true });
    const table = migrated
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_capability_usage'",
      )
      .get();
    migrated.close();
    expect(table).toBeDefined();
  });
});
```

- [ ] **Step 7: Persist capability rows transactionally and bump normalization**

Inside `persistSession()` after selecting the session row:

```ts
sqlite
  .prepare("DELETE FROM session_capability_usage WHERE session_id = ?")
  .run(row.id);
const capabilityStatement = sqlite.prepare(`INSERT INTO session_capability_usage
  (session_id, external_id, provider, kind, capability_name, occurred_at)
  VALUES (?, ?, ?, ?, ?, ?)`);
for (const capability of session.capabilityUsage) {
  capabilityStatement.run(
    row.id,
    capability.externalId,
    session.provider,
    capability.kind,
    capability.name,
    capability.occurredAt,
  );
}
```

Change `NORMALIZATION_VERSION` from `"10"` to `"11"`.

- [ ] **Step 8: Inject one lookup per production scan and watcher**

In `runSync()`, use `getAgentInventories({ kind: "global" })` and `buildCapabilityLookups()` once when the default adapters are used. Keep injected adapter tests isolated by using empty lookups unless `SyncOptions.capabilityLookups` is supplied. Pass `{ capabilities: lookups[adapter.provider] }` through `syncFile()` to `adapter.parse()`.

In `watchSources()`, build the lookups once before registering callbacks and pass the matching provider lookup on each changed file. Inventory changes take effect after watcher restart or the next full scan, as documented in the spec.

- [ ] **Step 9: Run migration, collector, and adapter tests**

Run: `npx vitest run src/db/migrate.test.ts src/collector/collector.test.ts src/collector/adapters/adapters.test.ts src/collector/capabilities.test.ts`

Expected: PASS, including idempotent replacement and cascade.

- [ ] **Step 10: Commit schema and persistence**

```bash
git add src/db/schema.ts src/db/client.ts src/db/migrate.ts src/db/migrate.test.ts drizzle src/collector/index.ts src/collector/collector.test.ts
git commit -m "✨ feat(db): persist session capability usage"
```

---

### Task 4: Authoritative Zcode database usage and database-only reconciliation

**Files:**

- Modify: `src/lib/zcode-db.ts`
- Modify: `src/collector/capabilities.ts`
- Modify: `src/collector/index.ts`
- Modify: `src/collector/collector.test.ts`
- Modify: `src/collector/adapters/adapters.test.ts`

**Interfaces:**

- Produces `ZcodeToolUsage`, `readZcodeToolUsage(sessionId)`, and `isZcodeDbAvailable()`.
- Produces a pure `zcodeStoredCapabilityUsage(messages, tools)` helper in `src/collector/capabilities.ts` or `src/collector/index.ts`; prefer `capabilities.ts` if it remains provider-neutral enough to test directly.
- Reconciliation replaces Zcode capability rows only when authoritative database reads succeed; unavailable database reads retain rollout-derived observations.

- [ ] **Step 1: Add a failing Zcode database fixture**

Extend the existing Zcode orphan-session collector test database with:

```sql
CREATE TABLE tool_usage (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL
);
```

Insert a `part.data` JSON object for a completed `Skill` call whose `state.input.skill` is `systematic-debugging`, and a `tool_usage` row named `mcp__plugin_openai-developers_openaiDeveloperDocs__search_openai_docs`. After `syncAll({ adapters: [] })`, assert the database-only session has one skill and one MCP row with no input/output data.

- [ ] **Step 2: Run the Zcode-focused tests and confirm no usage is reconciled**

Run: `npx vitest run src/collector/collector.test.ts -t "Zcode.*capability|database-only"`

Expected: FAIL because the Zcode read boundary does not expose tool usage and reconciliation does not replace capability rows.

- [ ] **Step 3: Add safe Zcode database APIs**

In `src/lib/zcode-db.ts`, add:

```ts
export interface ZcodeToolUsage {
  toolCallId: string;
  toolName: string;
  startedAt: number;
}

export function isZcodeDbAvailable(): boolean {
  return zcodeDb() !== undefined;
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
```

- [ ] **Step 4: Derive and replace Zcode capability observations**

For skill parts, accept only `data.type === "tool"`, `data.tool === "Skill"`, and a safe `state.input.skill`. Use the part ID as the stable external ID and `new Date(part.timeCreated).toISOString()` as timestamp. For `readZcodeToolUsage()`, normalize only namespaced MCP calls and use `toolCallId` plus `startedAt`.

Factor persistence into:

```ts
function replaceCapabilityUsage(
  sessionId: number,
  provider: AgentProvider,
  capabilityUsage: CapabilityUsage[],
): void;
```

Call it from `persistSession()` and from `reconcileZcodeMetadata()`. For database-only sessions, include authoritative capability usage in the `NormalizedSession` passed to `persistSession()`.

- [ ] **Step 5: Verify database-only, missing-table, and privacy behavior**

Run: `npx vitest run src/collector/collector.test.ts src/collector/adapters/adapters.test.ts`

Expected: PASS. Existing Zcode fixtures without `tool_usage` must continue to pass because the read API returns `undefined` on an unavailable table.

- [ ] **Step 6: Commit Zcode reconciliation**

```bash
git add src/lib/zcode-db.ts src/collector/capabilities.ts src/collector/index.ts src/collector/collector.test.ts src/collector/adapters/adapters.test.ts
git commit -m "✨ feat(zcode): reconcile capability usage from session database"
```

---

### Task 5: Insights aggregation, live inventory comparison, range parsing, and coverage

**Files:**

- Modify: `src/lib/queries.ts`
- Modify: `src/lib/insights.test.ts`

**Interfaces:**

- Produces `CapabilityRange = "7d" | "30d"` and `parseCapabilityRange(value): CapabilityRange`.
- Produces `CapabilityInsight`, `UnusedCapabilityInsight`, `CapabilityCoverage`, and `CapabilitiesInsight` types.
- Changes the query signature to `getInsights(capabilityRange?: CapabilityRange, inventories?: AgentInventory[]): Insights`; omitted arguments remain valid for existing cache/cost tests.

- [ ] **Step 1: Extend isolated fixtures with inventory and capability observations**

In `src/lib/insights.test.ts`, set `ZCODE_DB_PATH` to a missing temp path before imports, insert successful `adapter_scans` rows for Codex and Claude, and add capability observations at 2, 10, and 40 days old. Define inventories containing:

- active `frontend-rules` used by Codex and Claude;
- active `review-code-changes` used only 40 days ago;
- active `never-used` with no observations;
- active `github` MCP used by both providers;
- disabled `disabled-skill`, which must never appear as unused.

Use this fixture helper so status and provider identity remain explicit:

```ts
function capability(
  provider: AgentProvider,
  kind: "skill" | "mcp",
  name: string,
  status: "enabled" | "installed" | "disabled" = "installed",
): AgentCapability {
  return {
    id: `${provider}:${kind}:${name}`,
    name,
    kind,
    status,
    packaging: "standalone",
    origin: "personal",
  };
}

const inventories: AgentInventory[] = [
  {
    provider: "codex",
    scope: "global",
    warnings: [],
    capabilities: [
      capability("codex", "skill", "frontend-rules", "enabled"),
      capability("codex", "skill", "review-code-changes"),
      capability("codex", "skill", "never-used"),
      capability("codex", "skill", "disabled-skill", "disabled"),
      capability("codex", "mcp", "github", "enabled"),
    ],
  },
  {
    provider: "claude",
    scope: "global",
    warnings: [],
    capabilities: [
      capability("claude", "skill", "frontend-rules"),
      capability("claude", "mcp", "github"),
    ],
  },
];
```

Insert sessions and observations through prepared statements, using `iso(2 * DAY_MS)`, `iso(10 * DAY_MS)`, and `iso(40 * DAY_MS)` so range behavior remains stable relative to the test clock. Insert two `frontend-rules` observations in different sessions, one 40-day `review-code-changes` observation, and multiple `github` calls across Codex and Claude.

- [ ] **Step 2: Write failing range, ranking, and unused tests**

Add tests with these exact assertions:

```ts
expect(queries.parseCapabilityRange(undefined)).toBe("30d");
expect(queries.parseCapabilityRange("7d")).toBe("7d");
expect(queries.parseCapabilityRange("all")).toBe("30d");

const capabilities = queries.getInsights("30d", inventories).capabilities;
expect(capabilities.range).toBe("30d");
expect(
  capabilities.mostUsed.filter((item) => item.kind === "skill")[0],
).toMatchObject({
  name: "frontend-rules",
  invocations: 2,
  sessionCount: 2,
  providers: ["codex", "claude"],
});
expect(capabilities.unused).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      name: "review-code-changes",
      neverObserved: false,
    }),
    expect.objectContaining({ name: "never-used", neverObserved: true }),
  ]),
);
expect(capabilities.unused.map((item) => item.name)).not.toContain(
  "disabled-skill",
);
```

Add a 7-day assertion showing the 10-day observation excluded from ranking, and a partial-coverage assertion showing a provider with scan errors omitted from unused provider badges.

- [ ] **Step 3: Run Insights tests and confirm the missing capability section**

Run: `npx vitest run src/lib/insights.test.ts`

Expected: FAIL because `parseCapabilityRange` and `Insights.capabilities` do not exist.

- [ ] **Step 4: Add types and SQL aggregation**

In `src/lib/queries.ts`, define:

```ts
export type CapabilityRange = "7d" | "30d";

export interface CapabilityInsight {
  kind: "skill" | "mcp";
  name: string;
  invocations: number;
  sessionCount: number;
  lastUsedAt: string;
  providers: AgentProvider[];
}

export interface UnusedCapabilityInsight {
  kind: "skill" | "mcp";
  name: string;
  providers: AgentProvider[];
  lastUsedAt: string | null;
  neverObserved: boolean;
}

export interface CapabilityCoverage {
  provider: AgentProvider;
  state: "complete" | "partial" | "unavailable";
  message?: string;
}

export interface CapabilitiesInsight {
  range: CapabilityRange;
  mostUsed: CapabilityInsight[];
  unused: UnusedCapabilityInsight[];
  coverage: CapabilityCoverage[];
}
```

Query rows within the range using `COUNT(*)`, `COUNT(DISTINCT session_id)`, `MAX(occurred_at)`, and distinct providers. Split by kind and retain the first five of each kind after sorting by invocations, session count, last-used timestamp, and name.

- [ ] **Step 5: Implement installed-versus-used and coverage semantics**

Build an all-history map keyed by `provider:kind:canonicalCapabilityName(name)`. Derive coverage from `adapter_scans`:

- no row or zero sources → `unavailable`;
- errors greater than zero → `partial`;
- otherwise `complete`, except Zcode becomes `partial` when `isZcodeDbAvailable()` is false.

For active inventory entries on complete providers, compare last use to the selected cutoff. Group unused entries by canonical kind/name, merge provider badges in `agentProviders` order, use the most recent historical last-use timestamp, and set `neverObserved` only when none of the grouped provider installations has any history. Sort never-observed first, then null/oldest last use, then name.

- [ ] **Step 6: Run Insights and full query tests**

Run: `npx vitest run src/lib/insights.test.ts src/lib/queries.test.ts`

Expected: PASS with existing cache and cost behavior unchanged.

- [ ] **Step 7: Commit the query boundary**

```bash
git add src/lib/queries.ts src/lib/insights.test.ts
git commit -m "✨ feat(insights): derive skill and MCP usage signals"
```

---

### Task 6: Capability usage card, URL-backed range, responsive styles, and component tests

**Files:**

- Create: `src/components/capability-usage-card.tsx`
- Create: `src/components/capability-usage-card.test.tsx`
- Modify: `src/components/insights-view.tsx`
- Modify: `src/app/insights/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**

- `CapabilityUsageCard({ capabilities }: { capabilities: CapabilitiesInsight })` renders the new full-width card.
- `InsightsPage` awaits `searchParams`, parses `capabilityRange`, discovers global inventories, and calls `getInsights(range, inventories)`.
- `InsightsView` remains responsible for polling and composes `CapabilityUsageCard` after the two existing cards.

- [ ] **Step 1: Read the current design system before UI edits**

Read: `src/app/globals.css`, especially `.card`, `.badge`, `.badge-1` through `.badge-5`, `.insights-grid`, `.insight-card`, focus styles, and mobile media queries.

Record the existing component classes to reuse; do not add a raw color, arbitrary value, inline style, or `dark:` variant.

- [ ] **Step 2: Write failing component tests**

Create a jsdom test that mocks `next/navigation` and covers ranking, range updates, disclosure, and coverage:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CapabilitiesInsight } from "@/lib/queries";
import { CapabilityUsageCard } from "./capability-usage-card";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/insights",
  useRouter: () => ({ replace }),
}));

afterEach(() => {
  cleanup();
  replace.mockReset();
});

const fixtureCapabilities: CapabilitiesInsight = {
  range: "30d",
  mostUsed: [
    {
      kind: "skill",
      name: "frontend-rules",
      invocations: 2,
      sessionCount: 2,
      lastUsedAt: "2026-07-22T10:00:00Z",
      providers: ["codex", "claude"],
    },
    {
      kind: "mcp",
      name: "github",
      invocations: 4,
      sessionCount: 2,
      lastUsedAt: "2026-07-22T10:05:00Z",
      providers: ["codex", "claude"],
    },
  ],
  unused: Array.from({ length: 9 }, (_, index) => ({
    kind: "skill" as const,
    name: `unused-${index + 1}`,
    providers: ["codex" as const],
    lastUsedAt: null,
    neverObserved: true,
  })),
  coverage: [
    { provider: "codex", state: "complete" },
    {
      provider: "pi",
      state: "unavailable",
      message: "No readable session sources.",
    },
  ],
};

it("renders most-used and unused capability states", () => {
  render(<CapabilityUsageCard capabilities={fixtureCapabilities} />);
  expect(
    screen.getByRole("heading", { name: "Skills & MCP usage" }),
  ).toBeVisible();
  expect(screen.getByText("frontend-rules")).toBeVisible();
  expect(screen.getByText("github")).toBeVisible();
  const neverObserved = screen.getAllByText(
    "Never observed in available history",
  );
  expect(neverObserved).toHaveLength(9);
  expect(neverObserved[0]).toBeVisible();
  expect(neverObserved[8]).not.toBeVisible();
  expect(screen.getByText(/2 uses · 2 sessions/)).toBeVisible();
});

it("writes only non-default range selection to the URL", () => {
  render(<CapabilityUsageCard capabilities={fixtureCapabilities} />);
  fireEvent.click(screen.getByRole("button", { name: "7 days" }));
  expect(replace).toHaveBeenCalledWith("/insights?capabilityRange=7d");
});
```

Use at least nine unused fixture rows and assert the ninth appears inside a `<details>` element whose summary says `Show all 9 unused capabilities`. Add a partial coverage fixture and assert the explanatory note names the omitted provider.

- [ ] **Step 3: Run the component test and confirm the missing component failure**

Run: `npx vitest run src/components/capability-usage-card.test.tsx`

Expected: FAIL because `capability-usage-card.tsx` does not exist.

- [ ] **Step 4: Implement the page data flow**

Change `src/app/insights/page.tsx` to the Next.js 16 async search-params pattern:

```tsx
interface InsightsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function InsightsPage({
  searchParams,
}: InsightsPageProps) {
  const params = await searchParams;
  const range = parseCapabilityRange(first(params.capabilityRange));
  const inventories = await getAgentInventories({ kind: "global" });
  const health = getCollectorHealth();
  return (
    <main className="relay-shell">
      <Sidebar
        connectedAgents={health.connectedAgents}
        sourceErrors={health.parseErrors}
      />
      <InsightsView insights={getInsights(range, inventories)} />
    </main>
  );
}
```

- [ ] **Step 5: Implement the focused capability card**

In `src/components/capability-usage-card.tsx`:

- render two ranked lists, one for `skill` and one for `mcp`;
- show `N uses · M session(s)`, `relativeTime(lastUsedAt)`, and provider badges;
- map providers through a typed `Record<AgentProvider, string>` to `.badge-1` through `.badge-4`;
- render eight unused rows directly and remaining rows inside `<details>`;
- show `Last used …` or `Never observed in available history`;
- show a coverage note only when a provider is not complete;
- update `capabilityRange` with `router.replace`, deleting it for the default `30d` and setting it to `7d` otherwise;
- give range buttons `aria-pressed` and preserve unrelated query parameters.
- update the Insights page description so it mentions observed skill/MCP usage alongside cache and cost signals.

- [ ] **Step 6: Integrate the card and add semantic CSS**

Import and render the new card after `CostCard` in `src/components/insights-view.tsx`:

```tsx
<div className="insights-grid">
  <CacheCard insights={insights} />
  <CostCard insights={insights} />
  <CapabilityUsageCard capabilities={insights.capabilities} />
</div>
```

Add named component classes in `src/app/globals.css` for:

```css
.capability-insight {
  grid-column: 1 / -1;
}
.capability-insight-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.7rem;
}
.capability-range {
  display: inline-flex;
  gap: 0.25rem;
}
.capability-range-option {
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  padding: 0.4rem 0.65rem;
  color: var(--muted-foreground);
}
.capability-range-option[aria-pressed="true"] {
  background: var(--accent);
  color: var(--primary-foreground);
}
.capability-usage-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.8rem;
}
.capability-usage-list {
  display: grid;
  gap: 0.4rem;
}
.capability-usage-row {
  display: grid;
  gap: 0.25rem;
  padding-block: 0.45rem;
  border-bottom: 1px solid var(--border);
}
.capability-usage-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  color: var(--muted-foreground);
  font-size: var(--text-xs);
}
.capability-unused {
  margin-top: 0.3rem;
}
.capability-unused-more summary {
  cursor: pointer;
  color: var(--muted-foreground);
  font-size: var(--text-xs);
}
.capability-coverage {
  color: var(--muted-foreground);
  font-size: var(--text-xs);
}
```

The `0.375rem` control radius matches the existing `.btn`, `.input`, and `.select` design-system components. In the existing mobile media query, set `.capability-usage-columns { grid-template-columns: 1fr; }` and confirm long capability names wrap.

- [ ] **Step 7: Run component, lint, and type checks**

Run: `npx vitest run src/components/capability-usage-card.test.tsx src/lib/insights.test.ts`

Expected: PASS.

Run: `npm run lint && npm run typecheck && npx prettier --check src/app/insights/page.tsx src/components/insights-view.tsx src/components/capability-usage-card.tsx src/components/capability-usage-card.test.tsx src/app/globals.css`

Expected: all commands exit 0.

- [ ] **Step 8: Commit the Insights interface**

```bash
git add src/app/insights/page.tsx src/components/insights-view.tsx src/components/capability-usage-card.tsx src/components/capability-usage-card.test.tsx src/app/globals.css
git commit -m "✨ feat(insights): show skill and MCP usage"
```

---

### Task 7: Documentation, historical backfill, browser QA, and full verification

**Files:**

- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Review: all files changed by Tasks 1–6

**Interfaces:**

- Consumes the completed collection, query, and UI feature.
- Produces user-facing documentation, architecture guidance, a backfilled local database, and fresh verification evidence.

- [ ] **Step 1: Update user-facing route documentation**

Update the `/insights` row in `README.md` to include:

> Skills & MCP usage shows the most-observed capabilities over 7 or 30 days and active installed capabilities with no observed use. "Never observed" refers only to available local history; providers with incomplete source coverage are excluded from unused conclusions.

Keep the existing cache-effectiveness and cost-outlier descriptions intact.

- [ ] **Step 2: Update architecture and privacy documentation**

In both `AGENTS.md` and `CLAUDE.md`, document:

- `session_capability_usage` as the privacy-safe normalized boundary;
- the exact provider rules: native Claude/Zcode `Skill`, inventory-matched Codex/Pi `SKILL.md` reads, and namespaced MCP calls;
- that no prompts, arguments, results, contents, credentials, or raw config are stored;
- the normalization-version backfill requirement;
- `getInsights(range, inventories)` combining persisted observations with live active inventory and coverage;
- plugin activity remains outside the feature.

- [ ] **Step 3: Format and run targeted tests before touching live data**

Run Prettier only on files owned by this feature so unrelated untracked Markdown remains untouched:

```bash
npx prettier --write src/lib/types.ts src/collector/capabilities.ts src/collector/capabilities.test.ts src/collector/adapters/shared.ts src/collector/adapters/claude.ts src/collector/adapters/codex.ts src/collector/adapters/pi.ts src/collector/adapters/zcode.ts src/collector/adapters/adapters.test.ts src/db/schema.ts src/db/client.ts src/db/migrate.ts src/collector/index.ts src/collector/collector.test.ts src/lib/zcode-db.ts src/lib/queries.ts src/lib/insights.test.ts src/app/insights/page.tsx src/components/insights-view.tsx src/components/capability-usage-card.tsx src/components/capability-usage-card.test.tsx src/app/globals.css README.md AGENTS.md CLAUDE.md
```

Run: `npx vitest run src/collector/capabilities.test.ts src/collector/adapters/adapters.test.ts src/collector/collector.test.ts src/lib/insights.test.ts src/components/capability-usage-card.test.tsx`

Expected: PASS.

- [ ] **Step 4: Migrate and backfill the local Relay database**

Run: `npm run db:migrate`

Expected: migration completes and reports the Relay database path.

Run: `npm run collect -- --force`

Expected: full source scan completes; unchanged source files are reprocessed because `NORMALIZATION_VERSION` changed.

Verify safe aggregates only:

```bash
sqlite3 -header -column data/relay.db "
SELECT provider, kind, COUNT(*) AS observations,
       COUNT(DISTINCT capability_name) AS capabilities
FROM session_capability_usage
GROUP BY provider, kind
ORDER BY provider, kind;"
```

Expected: rows contain only provider/kind/count aggregates; no prompts or arguments are queried or printed.

- [ ] **Step 5: Start the app and perform browser verification**

Run: `npm run dev`

Open `/insights` using the browser verification workflow and confirm:

1. Existing Cache effectiveness and Cost outliers cards remain present.
2. Skills and MCP lists show live ranked observations.
3. The default range is 30 days and no default query parameter is required.
4. Selecting 7 days updates `capabilityRange=7d`, persists across refresh, and changes applicable counts.
5. Unused rows distinguish last-used from never-observed.
6. The native disclosure exposes rows after the first eight.
7. Partial/unavailable provider coverage displays a note and does not create false unused badges.
8. Desktop and 390px layouts have no body overflow; long names and badges wrap.
9. Focus, hover, empty, disclosure-open, and range-selected states remain legible.
10. The browser console contains no new errors or hydration warnings.

- [ ] **Step 6: Run the full repository Definition of Done**

Run: `npm run verify`

Expected: lint, typecheck, format check, all Vitest suites, and production build exit 0. If unrelated untracked Markdown or `.zcode/plans/*` causes format noise, preserve those user files, run the exact targeted checks for changed files, and report the baseline failure verbatim; do not weaken `verify`.

- [ ] **Step 7: Review documentation against final behavior**

Re-read `README.md`, `AGENTS.md`, and `CLAUDE.md` after browser QA. Confirm names, default range, privacy boundary, coverage semantics, and provider rules match the shipped behavior. Correct any drift and rerun `npm run format:check`.

- [ ] **Step 8: Commit documentation and verification-ready state**

```bash
git add README.md AGENTS.md CLAUDE.md
git commit -m "📝 docs: document capability usage insights"
```

- [ ] **Step 9: Final clean-state audit**

Run: `git status --short --branch && git log --oneline --decorate -8`

Expected: the feature worktree contains only intentionally preserved pre-existing user files, and the feature commits are visible on `codex/feat/capability-usage-insights`. Do not push or merge unless the user requests it.
