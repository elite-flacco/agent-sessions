# Scheduled Tasks Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third URL-backed "Scheduled tasks" tab to `/agents` that surfaces each provider's native scheduled/recurring tasks (Codex automations, Claude scheduled-tasks dirs, Zcode workflow_definition rows, Pi none) read-only and live.

**Architecture:** Extend the existing `src/lib/agent-inventory/` live-read boundary with a new `ScheduledTask` type and one reader per provider. No SQLite persistence, no collector changes. A new `ScheduledTasksView` renders under a third tab in `agent-setup-view.tsx`, parallel to Inventory and Compare. Schedule strings are humanized by a new `schedule.ts` when parseable.

**Tech Stack:** Next.js (App Router), React (server components + small client bits), TypeScript, vitest + @testing-library/react, better-sqlite3 (read-only), prettier, eslint.

## Global Constraints

- **Live-read only, never persisted.** Scheduled tasks live in `src/lib/agent-inventory/` and never enter SQLite or the collector — same boundary as capabilities.
- **Allowlist exception (from spec §7):** scheduled-task readers surface the instruction body **verbatim** (Codex `prompt`, Zcode `script_path` file contents, Claude `SKILL.md` body). This is a deliberate, user-accepted exception to the `/agents` allowlist rule. Do not extend it to other capability kinds. Update `AGENTS.md` to document it (Task 10).
- **Styling:** semantic tokens and component classes from `src/app/globals.css` only. No raw Tailwind palette colors, arbitrary values, inline styles, or `dark:` variants.
- **Verification:** there is no `.github/workflows/` directory. Mirror CI locally with `npm run verify` (runs lint → typecheck → format:check → test:run → build). Every task's final step runs the relevant subset and the last task runs the full `npm run verify`.
- **Branch:** create `zcode/feat/scheduled-tasks-tab` off the current branch before Task 1. Current branch is `zcode/feat/insights-page`.
- **No new npm dependencies.** rrule parsing is hand-rolled (small subset). TOML parsing reuses the existing hand-rolled parser in `codex.ts`.
- **Provider order:** `agentProviders = ["codex", "claude", "zcode", "pi"]` (from `src/lib/types.ts`). Always render/discover in this order.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/agent-inventory/types.ts` (modify) | Add `ScheduledTask`, `ScheduledTaskStatus`, `ScheduledTaskInstructionFormat`; extend `AgentInventory` with `scheduledTasks: ScheduledTask[]` |
| `src/lib/agent-inventory/schedule.ts` (create) | `humanizeSchedule(raw)` — hand-rolled rrule → human string; returns `undefined` when unsupported |
| `src/lib/agent-inventory/schedule.test.ts` (create) | rrule parser unit tests |
| `src/lib/agent-inventory/codex.ts` (modify) | Add `discoverCodexScheduledTasks(homeDir)`; called from `discoverCodex` |
| `src/lib/agent-inventory/claude.ts` (modify) | Add `discoverClaudeScheduledTasks(homeDir)`; called from `discoverClaude` |
| `src/lib/agent-inventory/zcode.ts` (modify) | Add `discoverZcodeScheduledTasks()` reading `workflow_definition` via a new `src/lib/zcode-db.ts` helper |
| `src/lib/zcode-db.ts` (modify) | Add `listZcodeWorkflowDefinitions()` + `__resetZcodeDbCache` already exists |
| `src/lib/agent-inventory/pi.ts` (modify) | Add `discoverPiScheduledTasks()` returning `[]` |
| `src/lib/agent-inventory/shared.ts` (modify) | Add `readDirectoryEntries` + `parseFrontmatter` helpers used by Codex/Claude readers |
| `src/lib/agent-inventory/index.ts` (modify) | Ensure each discoverer wires its tasks into the returned `AgentInventory` (the wiring lives in each reader, index just merges) |
| `src/lib/agent-inventory/discovery.test.ts` (modify) | Add scheduled-task discovery assertions to existing tests + new tests |
| `src/components/agent-setup-view.tsx` (modify) | Add `"tasks"` to `AgentSetupViewMode`; add third tab; add `ScheduledTasksView` + `ScheduledTaskRow` |
| `src/components/agent-setup-view.test.tsx` (modify) | Extend fixtures with `scheduledTasks: []`; add `view=tasks` tests |
| `AGENTS.md` (modify) | Document the allowlist exception + new tab |
| `README.md` (modify) | Mention the Scheduled tasks tab in the `/agents` row |

---

## Task 1: Branch + extend types

**Files:**
- Create branch `zcode/feat/scheduled-tasks-tab` off current `zcode/feat/insights-page`
- Modify: `src/lib/agent-inventory/types.ts`
- Modify (fixups): every file that constructs an `AgentInventory` literal — `src/lib/agent-inventory/index.ts` (the empty-shell fallback), `src/components/agent-setup-view.test.tsx` (4 fixture literals), `src/lib/agent-inventory/discovery.test.ts` (none directly — it calls `getAgentInventories`, so it's fine)

**Interfaces:**
- Produces: `ScheduledTask`, `ScheduledTaskStatus`, `ScheduledTaskInstructionFormat` types; `AgentInventory.scheduledTasks: ScheduledTask[]` (required field)

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b zcode/feat/scheduled-tasks-tab zcode/feat/insights-page
```

Verify: `git branch --show-current` prints `zcode/feat/scheduled-tasks-tab`.

- [ ] **Step 2: Extend `types.ts`**

Add after the `AgentCapability` interface (before `InstructionFile`):

```ts
export type ScheduledTaskStatus = "active" | "paused" | "disabled" | "unknown";

export type ScheduledTaskInstructionFormat =
  | "toml_prompt"
  | "skill_md"
  | "script";

export interface ScheduledTask {
  id: string;
  name: string;
  description?: string;
  provider: AgentProvider;
  scheduleRaw?: string;
  scheduleHuman?: string;
  scheduleMissing: boolean;
  status: ScheduledTaskStatus;
  model?: string;
  targetProject?: string;
  workingDirectories?: string[];
  instructionBody?: string;
  instructionFormat: ScheduledTaskInstructionFormat;
  sourcePath: string;
  createdAt?: number;
  updatedAt?: number;
  warnings: InventoryWarning[];
}
```

Then extend `AgentInventory` — change the interface to add `scheduledTasks` as a **required** field (cleaner contract than optional). In `types.ts`:

```ts
export interface AgentInventory {
  provider: AgentProvider;
  scope: "global";
  capabilities: AgentCapability[];
  scheduledTasks: ScheduledTask[];
  instructionFile?: InstructionFile;
  warnings: InventoryWarning[];
}
```

- [ ] **Step 3: Fix the empty-shell fallback in `index.ts`**

In `src/lib/agent-inventory/index.ts`, the fallback object (around line 62) currently omits `scheduledTasks`. Update it:

```ts
return agentProviders.map(
  (provider) =>
    inventories.find((inventory) => inventory.provider === provider) ?? {
      provider,
      scope: "global" as const,
      capabilities: [],
      scheduledTasks: [],
      warnings: [],
    },
);
```

- [ ] **Step 4: Fix the 4 fixture literals in `agent-setup-view.test.tsx`**

Each of the four `AgentInventory` objects in the `inventories` array (lines ~26–86) needs `scheduledTasks: []` added. Add it right after `capabilities: [...]` in each. Example for the codex fixture:

```ts
{
  provider: "codex",
  scope: "global",
  capabilities: [/* ... */],
  scheduledTasks: [],
  instructionFile: { /* ... */ },
  warnings: [],
},
```

Do the same for claude, zcode, and pi fixtures.

- [ ] **Step 5: Run typecheck + tests + format**

```bash
npm run typecheck
npm run test:run
npm run format:check
```

Expected: typecheck passes (no `scheduledTasks` missing errors), all existing tests still pass (fixtures now satisfy the new required field), format clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent-inventory/types.ts src/lib/agent-inventory/index.ts src/components/agent-setup-view.test.tsx
git commit -m "🔧 chore(agents): add ScheduledTask type and required scheduledTasks field"
```

---

## Task 2: Schedule humanizer (rrule → human)

**Files:**
- Create: `src/lib/agent-inventory/schedule.ts`
- Create: `src/lib/agent-inventory/schedule.test.ts`

**Interfaces:**
- Produces: `humanizeSchedule(raw: string): string | undefined`

- [ ] **Step 1: Write the failing test**

Create `src/lib/agent-inventory/schedule.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { humanizeSchedule } from "./schedule";

describe("humanizeSchedule", () => {
  test("weekly single day with time", () => {
    expect(
      humanizeSchedule("FREQ=WEEKLY;BYDAY=MO;BYHOUR=8;BYMINUTE=0;BYSECOND=0"),
    ).toBe("Mondays at 08:00");
  });

  test("weekly multiple days", () => {
    expect(
      humanizeSchedule("FREQ=WEEKLY;BYDAY=MO;BYDAY=WE;BYDAY=FR;BYHOUR=9;BYMINUTE=30"),
    ).toBe("Mondays, Wednesdays, Fridays at 09:30");
  });

  test("daily with time", () => {
    expect(humanizeSchedule("FREQ=DAILY;BYHOUR=0;BYMINUTE=0")).toBe(
      "Daily at 00:00",
    );
  });

  test("monthly with day-of-month and time", () => {
    expect(
      humanizeSchedule("FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=0;BYMINUTE=0"),
    ).toBe("Monthly on day 1 at 00:00");
  });

  test("weekly without time defaults to 00:00", () => {
    expect(humanizeSchedule("FREQ=WEEKLY;BYDAY=MO")).toBe("Mondays at 00:00");
  });

  test("returns undefined for unsupported FREQ", () => {
    expect(humanizeSchedule("FREQ=YEARLY")).toBeUndefined();
  });

  test("returns undefined for unparseable input", () => {
    expect(humanizeSchedule("not-an-rrule")).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    expect(humanizeSchedule("")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/agent-inventory/schedule.test.ts
```

Expected: FAIL — `Failed to resolve import "./schedule"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/agent-inventory/schedule.ts`:

```ts
const DAY_NAMES: Record<string, string> = {
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
  SU: "Sunday",
};

function parsePairs(raw: string): Map<string, string[]> {
  // rrule allows repeated keys (BYDAY=MO;BYDAY=WE) — collect all values per key.
  const map = new Map<string, string[]>();
  for (const part of raw.split(";")) {
    const [key, value] = part.split("=");
    if (!key || value === undefined) continue;
    const list = map.get(key.toUpperCase());
    if (list) list.push(value);
    else map.set(key.toUpperCase(), [value]);
  }
  return map;
}

function ordinal(n: number): string {
  return n === 1 || n === 21 || n === 31
    ? `${n}st`
    : n === 2 || n === 22
      ? `${n}nd`
      : n === 3 || n === 23
        ? `${n}rd`
        : `${n}th`;
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Best-effort humanizer for the rrule subset Codex automations emit.
 * Returns undefined when the input isn't a supported rrule so callers can
 * fall back to the raw schedule string. Time is wall-clock local (24h).
 */
export function humanizeSchedule(raw: string): string | undefined {
  if (!raw.trim()) return undefined;
  const pairs = parsePairs(raw);
  const freq = pairs.get("FREQ")?.[0]?.toUpperCase();
  const hour = Number.parseInt(pairs.get("BYHOUR")?.[0] ?? "0", 10);
  const minute = Number.parseInt(pairs.get("BYMINUTE")?.[0] ?? "0", 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return undefined;
  const time = formatTime(hour, minute);

  if (freq === "DAILY") return `Daily at ${time}`;

  if (freq === "WEEKLY") {
    const days = pairs.get("BYDAY") ?? [];
    const named = days
      .map((d) => DAY_NAMES[d.toUpperCase()])
      .filter((d): d is string => Boolean(d));
    if (named.length === 0) return undefined;
    const pluralized = named.map((d) => `${d}s`);
    return `${pluralized.join(", ")} at ${time}`;
  }

  if (freq === "MONTHLY") {
    const monthDay = Number.parseInt(
      pairs.get("BYMONTHDAY")?.[0] ?? "",
      10,
    );
    if (Number.isNaN(monthDay)) return undefined;
    return `Monthly on day ${monthDay} at ${time}`;
  }

  return undefined;
}
```

Note: `ordinal` is defined but only used if we later support BYSETPOS weekday-in-month; remove it if eslint flags it as unused (it isn't used in the minimal implementation — **delete the `ordinal` function before committing** to keep the file clean).

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/agent-inventory/schedule.test.ts
```

Expected: PASS, all 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-inventory/schedule.ts src/lib/agent-inventory/schedule.test.ts
git commit -m "✨ feat(agents): add rrule schedule humanizer"
```

---

## Task 3: Shared helpers (frontmatter + directory entries)

**Files:**
- Modify: `src/lib/agent-inventory/shared.ts`

**Interfaces:**
- Produces: `readDirectoryEntries(dir: string): Promise<string[]>` (returns absolute child paths, empty on missing dir, never throws); `parseFrontmatter(content: string): { data: Record<string, string>; body: string }` (splits YAML frontmatter from body, returns `{ data: {}, body: content }` when no frontmatter)

- [ ] **Step 1: Write the failing test**

Append to a new section at the bottom of `src/lib/agent-inventory/schedule.test.ts` is wrong — create a dedicated test file `src/lib/agent-inventory/shared.test.ts`:

```ts
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { parseFrontmatter, readDirectoryEntries } from "./shared";

const dirs: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true })));
});

describe("readDirectoryEntries", () => {
  test("returns child paths for an existing directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shared-test-"));
    dirs.push(dir);
    await mkdir(join(dir, "a"));
    await mkdir(join(dir, "b"));
    const entries = await readDirectoryEntries(dir);
    expect(entries.sort()).toEqual([
      join(dir, "a"),
      join(dir, "b"),
    ]);
  });

  test("returns empty array for missing directory", async () => {
    expect(await readDirectoryEntries(join(tmpdir(), "does-not-exist"))).toEqual(
      [],
    );
  });
});

describe("parseFrontmatter", () => {
  test("parses name and description from frontmatter", () => {
    const result = parseFrontmatter(
      "---\nname: daily-pr-triage\ndescription: Daily PR check\n---\nBody here\n",
    );
    expect(result.data).toEqual({
      name: "daily-pr-triage",
      description: "Daily PR check",
    });
    expect(result.body).toBe("Body here\n");
  });

  test("returns whole content as body when no frontmatter", () => {
    const result = parseFrontmatter("just body\n");
    expect(result.data).toEqual({});
    expect(result.body).toBe("just body\n");
  });

  test("handles values wrapped in quotes", () => {
    const result = parseFrontmatter(
      '---\nname: "quoted name"\n---\nbody',
    );
    expect(result.data.name).toBe("quoted name");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/agent-inventory/shared.test.ts
```

Expected: FAIL — `parseFrontmatter` and `readDirectoryEntries` not exported.

- [ ] **Step 3: Add the two helpers to `shared.ts`**

At the bottom of `src/lib/agent-inventory/shared.ts`, add:

```ts
export async function readDirectoryEntries(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.map((entry) => join(dir, entry.name));
}

export function parseFrontmatter(content: string): {
  data: Record<string, string>;
  body: string;
} {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: content };
  const data: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    data[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return { data, body: match[2] };
}
```

(`readdir` and `join` are already imported at the top of `shared.ts`.)

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/agent-inventory/shared.test.ts
```

Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-inventory/shared.ts src/lib/agent-inventory/shared.test.ts
git commit -m "✨ feat(agents): add readDirectoryEntries and parseFrontmatter helpers"
```

---

## Task 4: Codex scheduled-task reader

**Files:**
- Modify: `src/lib/agent-inventory/codex.ts`
- Modify: `src/lib/agent-inventory/discovery.test.ts` (add assertions)

**Interfaces:**
- Consumes: `readDirectoryEntries`, `readTextSource`, `parseFrontmatter` from `./shared`; `humanizeSchedule` from `./schedule`; `ScheduledTask` from `./types`
- Produces: `discoverCodexScheduledTasks(homeDir: string): Promise<ScheduledTask[]>` — called inside `discoverCodex` and merged into the returned inventory's `scheduledTasks`

- [ ] **Step 1: Write the failing test**

Add a new test inside the existing `describe("getAgentInventories", ...)` block in `src/lib/agent-inventory/discovery.test.ts`:

```ts
test("discovers Codex scheduled tasks from automations TOML without leaking args", async () => {
  const home = await createHome();
  await fixture(
    home,
    ".codex/automations/weekly-digest/automation.toml",
    `version = 1
id = "weekly-digest"
kind = "cron"
name = "Weekly digest"
prompt = "Summarize the week. Do not leak SECRET_TOKEN."
status = "ACTIVE"
rrule = "FREQ=WEEKLY;BYDAY=MO;BYHOUR=8;BYMINUTE=0;BYSECOND=0"
model = "gpt-5.5"
execution_environment = "local"
target = { type = "project", project_id = "local-abc123" }
cwds = ["/Users/example/ws"]
created_at = 1783771983978
updated_at = 1783772547499
`,
  );

  const result = await getAgentInventories(
    { kind: "global" },
    { homeDir: home },
  );
  const codex = result.find((item) => item.provider === "codex");

  expect(codex?.scheduledTasks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "weekly-digest",
        name: "Weekly digest",
        scheduleRaw: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=8;BYMINUTE=0;BYSECOND=0",
        scheduleHuman: "Mondays at 08:00",
        scheduleMissing: false,
        status: "active",
        model: "gpt-5.5",
        targetProject: "local-abc123",
        instructionBody: "Summarize the week. Do not leak SECRET_TOKEN.",
        instructionFormat: "toml_prompt",
      }),
    ]),
  );
  // Per the spec's allowlist exception, the prompt body IS surfaced verbatim.
  expect(codex?.scheduledTasks[0]?.instructionBody).toContain("SECRET_TOKEN");
});

test("maps unknown Codex automation status to unknown", async () => {
  const home = await createHome();
  await fixture(
    home,
    ".codex/automations/odd-job/automation.toml",
    `version = 1
id = "odd-job"
kind = "cron"
name = "Odd job"
prompt = "do thing"
status = "WEIRD"
rrule = "FREQ=DAILY"
`,
  );

  const result = await getAgentInventories(
    { kind: "global" },
    { homeDir: home },
  );
  const codex = result.find((item) => item.provider === "codex");
  expect(codex?.scheduledTasks[0]?.status).toBe("unknown");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/agent-inventory/discovery.test.ts
```

Expected: FAIL — `codex?.scheduledTasks` is `[]` (the field exists from Task 1 but is never populated).

- [ ] **Step 3: Implement the reader in `codex.ts`**

At the top of `src/lib/agent-inventory/codex.ts`, add imports:

```ts
import { readDirectoryEntries, parseFrontmatter } from "./shared";
import { humanizeSchedule } from "./schedule";
import type { ScheduledTask, ScheduledTaskStatus } from "./types";
```

Add a TOML-key-value parser (the existing `tables()`/`tableKey()` only handle `[section]` tables, not top-level key/values in an `automation.toml`):

```ts
/** Parses `key = value` lines (and `key = [a, b]` arrays) from a flat TOML body. */
function parseTomlValues(body: string): {
  values: Record<string, string>;
  arrays: Record<string, string[]>;
} {
  const values: Record<string, string> = {};
  const arrays: Record<string, string[]> = {};
  for (const line of body.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][\w]*)\s*=\s*(.+?)\s*$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (raw.startsWith("[")) {
      const inner = raw.replace(/^\[/, "").replace(/\]$/, "");
      arrays[key] = inner
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);
    } else {
      values[key] = raw.replace(/^"|"$/g, "");
    }
  }
  return { values, arrays };
}

function statusFromToml(raw: string | undefined): ScheduledTaskStatus {
  switch ((raw ?? "").toUpperCase()) {
    case "ACTIVE":
      return "active";
    case "PAUSED":
      return "paused";
    case "DISABLED":
      return "disabled";
    default:
      return "unknown";
  }
}

export async function discoverCodexScheduledTasks(
  homeDir: string,
): Promise<ScheduledTask[]> {
  const warnings: ScheduledTask["warnings"] = [];
  const automationsDir = join(homeDir, ".codex", "automations");
  const tasks: ScheduledTask[] = [];
  for (const entry of await readDirectoryEntries(automationsDir)) {
    const tomlPath = join(entry, "automation.toml");
    const content = await readTextSource(tomlPath, warnings);
    if (!content) continue;
    const { values, arrays } = parseTomlValues(content);
    const id = values.id ?? basename(entry);
    const rrule = values.rrule;
    const scheduleHuman = rrule ? humanizeSchedule(rrule) : undefined;
    const target = values.target;
    const projectId = target.match(/project_id\s*=\s*"([^"]+)"/)?.[1];
    const descriptionLine = (values.prompt ?? "")
      .split("\n")
      .map((s) => s.trim())
      .find((s) => s.length > 0);
    tasks.push({
      id,
      name: values.name ?? id,
      description: descriptionLine,
      provider: "codex",
      scheduleRaw: rrule,
      scheduleHuman,
      scheduleMissing: !rrule,
      status: statusFromToml(values.status),
      model: values.model,
      targetProject: projectId,
      workingDirectories: arrays.cwds,
      instructionBody: values.prompt,
      instructionFormat: "toml_prompt",
      sourcePath: tomlPath,
      createdAt: Number.parseInt(values.created_at ?? "", 10) || undefined,
      updatedAt: Number.parseInt(values.updated_at ?? "", 10) || undefined,
      warnings: [],
    });
  }
  return tasks;
}
```

You'll need `basename` — add it to the existing `node:path` import at the top of `codex.ts`:

```ts
import { basename, join } from "node:path";
```

Then in `discoverCodex`, populate the field in the returned inventory (replace the existing `return { ... }` block — only the `scheduledTasks` line is new):

```ts
const scheduledTasks = await discoverCodexScheduledTasks(homeDir);
return {
  provider: "codex",
  scope: "global",
  capabilities: dedupeCapabilities(capabilities),
  scheduledTasks,
  instructionFile: await readInstruction(
    join(homeDir, ".codex", "AGENTS.md"),
    warnings,
  ),
  warnings,
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/agent-inventory/discovery.test.ts
```

Expected: PASS, all existing + 2 new tests.

- [ ] **Step 5: Run full local verification**

```bash
npm run typecheck && npm run test:run && npm run format:check
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent-inventory/codex.ts src/lib/agent-inventory/discovery.test.ts
git commit -m "✨ feat(agents): read Codex automations as scheduled tasks"
```

---

## Task 5: Claude scheduled-task reader

**Files:**
- Modify: `src/lib/agent-inventory/claude.ts`
- Modify: `src/lib/agent-inventory/discovery.test.ts`

**Interfaces:**
- Consumes: `readDirectoryEntries`, `readTextSource`, `parseFrontmatter` from `./shared`; `ScheduledTask` from `./types`
- Produces: `discoverClaudeScheduledTasks(homeDir: string): Promise<ScheduledTask[]>`

- [ ] **Step 1: Write the failing test**

Add to the `describe("getAgentInventories", ...)` block in `discovery.test.ts`:

```ts
test("discovers Claude scheduled tasks from scheduled-tasks SKILL.md", async () => {
  const home = await createHome();
  const taskDir = join(home, ".claude", "scheduled-tasks", "daily-pr-triage");
  await mkdir(taskDir, { recursive: true });
  await writeFile(
    join(taskDir, "SKILL.md"),
    "---\nname: daily-pr-triage\ndescription: Daily PR check\n---\nYou are running triage.\n",
  );

  const result = await getAgentInventories(
    { kind: "global" },
    { homeDir: home },
  );
  const claude = result.find((item) => item.provider === "claude");

  expect(claude?.scheduledTasks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "daily-pr-triage",
        name: "daily-pr-triage",
        description: "Daily PR check",
        scheduleMissing: true,
        status: "active",
        instructionFormat: "skill_md",
        instructionBody: "You are running triage.\n",
      }),
    ]),
  );
  // Claude scheduled-tasks don't store a schedule in-file.
  expect(claude?.scheduledTasks[0]?.scheduleRaw).toBeUndefined();
  expect(claude?.scheduledTasks[0]?.scheduleHuman).toBeUndefined();
});
```

(`mkdir` and `writeFile` are already imported at the top of `discovery.test.ts`.)

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/agent-inventory/discovery.test.ts
```

Expected: FAIL — claude scheduledTasks is `[]`.

- [ ] **Step 3: Implement the reader in `claude.ts`**

Add imports at the top of `src/lib/agent-inventory/claude.ts`:

```ts
import {
  capability,
  discoverPluginMcps,
  discoverSkillRoots,
  objectValue,
  parseFrontmatter,
  readDirectoryEntries,
  readInstruction,
  readJsonSource,
  readTextSource,
  safeAbsolutePath,
  type SkillLock,
} from "./shared";
import type {
  AgentCapability,
  AgentInventory,
  ScheduledTask,
} from "./types";
```

Add the reader function (before `discoverClaude`):

```ts
export async function discoverClaudeScheduledTasks(
  homeDir: string,
): Promise<ScheduledTask[]> {
  const tasks: ScheduledTask[] = [];
  const root = join(homeDir, ".claude", "scheduled-tasks");
  for (const entry of await readDirectoryEntries(root)) {
    const skillPath = join(entry, "SKILL.md");
    const content = await readTextSource(skillPath, []);
    if (!content) continue;
    const { data, body } = parseFrontmatter(content);
    const id = basename(entry);
    tasks.push({
      id,
      name: data.name ?? id,
      description: data.description,
      provider: "claude",
      scheduleMissing: true,
      status: "active",
      instructionBody: body,
      instructionFormat: "skill_md",
      sourcePath: skillPath,
      warnings: [],
    });
  }
  return tasks;
}
```

Add `basename` to the existing `node:path` import in `claude.ts` (it currently only imports `join`):

```ts
import { basename, join } from "node:path";
```

Wire it into `discoverClaude`'s return (only the `scheduledTasks` line is new):

```ts
const scheduledTasks = await discoverClaudeScheduledTasks(homeDir);
return {
  provider: "claude",
  scope: "global",
  capabilities: dedupeCapabilities(capabilities),
  scheduledTasks,
  instructionFile: await readInstruction(
    join(homeDir, ".claude", "CLAUDE.md"),
    warnings,
  ),
  warnings,
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/agent-inventory/discovery.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-inventory/claude.ts src/lib/agent-inventory/discovery.test.ts
git commit -m "✨ feat(agents): read Claude scheduled-tasks dirs as scheduled tasks"
```

---

## Task 6: Zcode scheduled-task reader (via `workflow_definition`)

**Files:**
- Modify: `src/lib/zcode-db.ts` (add `listZcodeWorkflowDefinitions`)
- Modify: `src/lib/agent-inventory/zcode.ts`
- Modify: `src/lib/agent-inventory/discovery.test.ts`

**Interfaces:**
- Consumes: `listZcodeWorkflowDefinitions()` from `@/lib/zcode-db`; `readTextSource` from `./shared`; `ScheduledTask` from `./types`; existing `ZCODE_DB_PATH` env seam and `__resetZcodeDbCache()`
- Produces: `discoverZcodeScheduledTasks(): Promise<ScheduledTask[]>` (reads `~/.zcode/cli/db/db.sqlite` via the seam)

- [ ] **Step 1: Write the failing test**

Add to `discovery.test.ts`. This test builds a temp sqlite db with `better-sqlite3` and points `ZCODE_DB_PATH` at it:

```ts
test("discovers Zcode scheduled tasks from workflow_definition rows", async () => {
  const dbPath = join(tmpdir(), `relay-zcode-tasks-${Date.now()}.sqlite`);
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE workflow_definition (
      id text primary key,
      name text not null,
      source text not null,
      trusted integer not null default 0,
      enabled integer not null default 1,
      script_path text,
      script_hash text not null,
      meta_json text not null,
      time_created integer not null,
      time_updated integer not null,
      scope text not null default 'user'
    );
  `);
  const scriptPath = join(tmpdir(), `relay-zcode-script-${Date.now()}.sh`);
  await writeFile(scriptPath, "#!/bin/sh\necho hello\n");
  db.prepare(
    `INSERT INTO workflow_definition (id, name, source, enabled, script_path, script_hash, meta_json, time_created, time_updated)
     VALUES (?, ?, 'user', 1, ?, 'hash', '{}', 1000, 2000)`,
  ).run("wf-1", "Nightly sync", scriptPath);
  db.close();

  process.env.ZCODE_DB_PATH = dbPath;
  const { __resetZcodeDbCache } = await import("@/lib/zcode-db");
  __resetZcodeDbCache();
  try {
    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: await createHome() },
    );
    const zcode = result.find((item) => item.provider === "zcode");

    expect(zcode?.scheduledTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "wf-1",
          name: "Nightly sync",
          status: "active",
          scheduleMissing: true,
          instructionFormat: "script",
          instructionBody: "#!/bin/sh\necho hello\n",
          sourcePath: scriptPath,
          updatedAt: 2000,
        }),
      ]),
    );
  } finally {
    __resetZcodeDbCache();
    delete process.env.ZCODE_DB_PATH;
    const { rm } = await import("node:fs/promises");
    await rm(dbPath, { force: true });
    await rm(scriptPath, { force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/agent-inventory/discovery.test.ts
```

Expected: FAIL — `listZcodeWorkflowDefinitions` doesn't exist / zcode scheduledTasks is `[]`.

- [ ] **Step 3: Add the DB helper to `zcode-db.ts`**

In `src/lib/zcode-db.ts`, add the interface and function near the other exports (before `__resetZcodeDbCache`):

```ts
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

export function listZcodeWorkflowDefinitions():
  | ZcodeWorkflowDefinition[]
  | undefined {
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
      timeCreated:
        typeof row.timeCreated === "number" ? row.timeCreated : 0,
      timeUpdated:
        typeof row.timeUpdated === "number" ? row.timeUpdated : 0,
    }));
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Implement the reader in `zcode.ts`**

Add imports at the top of `src/lib/agent-inventory/zcode.ts`:

```ts
import { listZcodeWorkflowDefinitions } from "@/lib/zcode-db";
import { readTextSource } from "./shared";
import type {
  AgentCapability,
  AgentInventory,
  ScheduledTask,
} from "./types";
```

Add the reader (before `discoverZcode`):

```ts
async function readScriptBody(
  scriptPath: string | undefined,
): Promise<string | undefined> {
  if (!scriptPath) return undefined;
  // Local warnings list — script read failure shouldn't poison the inventory.
  return readTextSource(scriptPath, []);
}

export async function discoverZcodeScheduledTasks(): Promise<ScheduledTask[]> {
  const definitions = listZcodeWorkflowDefinitions();
  if (!definitions) return [];
  const tasks: ScheduledTask[] = [];
  for (const def of definitions) {
    const body = await readScriptBody(def.scriptPath);
    tasks.push({
      id: def.id,
      name: def.name,
      provider: "zcode",
      scheduleMissing: true,
      status: def.enabled ? "active" : "disabled",
      instructionBody: body,
      instructionFormat: "script",
      sourcePath: def.scriptPath ?? "",
      createdAt: def.timeCreated,
      updatedAt: def.timeUpdated,
      warnings: body === undefined && def.scriptPath
        ? [
            {
              sourcePath: def.scriptPath,
              code: "unreadable" as const,
              message: "Could not read workflow script.",
            },
          ]
        : [],
    });
  }
  return tasks;
}
```

Wire into `discoverZcode`'s return:

```ts
const scheduledTasks = await discoverZcodeScheduledTasks();
return {
  provider: "zcode",
  scope: "global",
  capabilities: dedupeCapabilities(capabilities),
  scheduledTasks,
  instructionFile: await readInstruction(
    join(homeDir, ".zcode", "AGENTS.md"),
    warnings,
  ),
  warnings,
};
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run src/lib/agent-inventory/discovery.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/zcode-db.ts src/lib/agent-inventory/zcode.ts src/lib/agent-inventory/discovery.test.ts
git commit -m "✨ feat(agents): read Zcode workflow_definition rows as scheduled tasks"
```

---

## Task 7: Pi reader (returns `[]`) + final wiring check

**Files:**
- Modify: `src/lib/agent-inventory/pi.ts`

**Interfaces:**
- Produces: `discoverPiScheduledTasks(): Promise<ScheduledTask[]>` always `[]`

- [ ] **Step 1: Implement the no-op reader in `pi.ts`**

Add imports and function to `src/lib/agent-inventory/pi.ts`:

```ts
import type {
  AgentCapability,
  AgentInventory,
  ScheduledTask,
} from "./types";
```

(The existing import line `import type { AgentCapability, AgentInventory } from "./types";` should be extended to include `ScheduledTask`.)

Add the function (before `discoverPi`):

```ts
/**
 * Pi has no scheduled-task concept today. Returns an empty list so the
 * provider still renders an empty card in the Scheduled tasks tab.
 */
export async function discoverPiScheduledTasks(): Promise<ScheduledTask[]> {
  return [];
}
```

Wire into `discoverPi`'s return:

```ts
const scheduledTasks = await discoverPiScheduledTasks();
return {
  provider: "pi",
  scope: "global",
  capabilities: dedupeCapabilities(capabilities),
  scheduledTasks,
  instructionFile: await readInstruction(
    join(agentRoot, "AGENTS.md"),
    warnings,
  ),
  warnings,
};
```

- [ ] **Step 2: Run all discovery tests + typecheck**

```bash
npm run typecheck && npx vitest run src/lib/agent-inventory/
```

Expected: PASS — all four providers now populate `scheduledTasks`; Pi returns `[]`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/agent-inventory/pi.ts
git commit -m "✨ feat(agents): wire Pi scheduled-tasks reader (no-op, returns [])"
```

---

## Task 8: `ScheduledTasksView` UI + third tab

**Files:**
- Modify: `src/components/agent-setup-view.tsx`
- Modify: `src/components/agent-setup-view.test.tsx`

**Interfaces:**
- Consumes: `ScheduledTask` from `@/lib/agent-inventory`; `agentProviders`, `providerLabels`, `providerBadges` (existing); CSS classes `card`, `agent-provider-section`, `agent-provider-heading`, `agent-capability-list`, `agent-capability-row`, `agent-status-tag`, `badge-N`, `empty-state`, `notice`, `relay-content`
- Produces: third tab "Scheduled tasks" in `AgentSetupView`; new components `ScheduledTasksView`, `ProviderScheduledTasks`, `ScheduledTaskRow`

- [ ] **Step 1: Extend the filter parser and view mode**

In `src/components/agent-setup-view.tsx`:

Change `AgentSetupViewMode` (line 27):
```ts
export type AgentSetupViewMode = "inventory" | "compare" | "tasks";
```

In `parseAgentSetupFilters` (line 137), change the `view` line:
```ts
view:
  first(params.view) === "compare"
    ? "compare"
    : first(params.view) === "tasks"
      ? "tasks"
      : "inventory",
```

In `setupHref` (around line 162), update the view serialization so `tasks` round-trips:
```ts
if (next.view === "compare") params.set("view", "compare");
else if (next.view === "tasks") params.set("view", "tasks");
```

- [ ] **Step 2: Add the third tab link**

In the `workspace-switcher` `<nav>` (around line 232), add a third `<Link>` after the Compare one:

```tsx
<Link
  href={setupHref(filters, {
    view: "tasks",
    comparisonMode: undefined,
    discrepanciesOnly: undefined,
  })}
  className={
    filters.view === "tasks"
      ? "workspace-tab tab-active"
      : "workspace-tab"
  }
  aria-current={filters.view === "tasks" ? "page" : undefined}
>
  Scheduled tasks
</Link>
```

- [ ] **Step 3: Render the view body branch**

Replace the view-fork block (around line 267):

```tsx
{filters.view === "compare" ? (
  <ComparisonView inventories={inventories} filters={filters} />
) : filters.view === "tasks" ? (
  <ScheduledTasksView inventories={inventories} />
) : (
  <InventoryView inventories={inventories} filters={filters} />
)}
```

- [ ] **Step 4: Add `ScheduledTasksView` + child components**

Add the `ScheduledTask` import to the existing `@/lib/agent-inventory` import block at the top of the file:

```ts
import {
  buildComparisonRows,
  type AgentCapability,
  type AgentInventory,
  type CapabilityKind,
  type CapabilityStatus,
  type ComparisonRow,
  type ScheduledTask,
} from "@/lib/agent-inventory";
```

Add these components at the bottom of the file (after `UniformComparisonCell`):

```tsx
const scheduledStatusLabels: Record<ScheduledTask["status"], string> = {
  active: "Active",
  paused: "Paused",
  disabled: "Disabled",
  unknown: "Unknown",
};

const scheduledStatusBadges: Record<ScheduledTask["status"], string> = {
  active: "badge-1",
  paused: "badge-4",
  disabled: "badge-4",
  unknown: "badge-5",
};

const scheduledSourceLabels: Record<AgentProvider, string> = {
  codex: "Read from ~/.codex/automations/",
  claude: "Read from ~/.claude/scheduled-tasks/",
  zcode: "Read from ~/.zcode/cli/db/db.sqlite (workflow_definition)",
  pi: "Pi does not expose scheduled tasks",
};

function ScheduledTasksView({ inventories }: { inventories: AgentInventory[] }) {
  const total = inventories.reduce(
    (sum, inventory) => sum + inventory.scheduledTasks.length,
    0,
  );
  return (
    <div className="agent-inventory-list">
      <p className="agent-tasks-summary">
        {total === 0
          ? "No scheduled tasks found across agents."
          : `${total} scheduled ${total === 1 ? "task" : "tasks"} across agents.`}
      </p>
      {inventories.map((inventory) => (
        <ProviderScheduledTasks key={inventory.provider} inventory={inventory} />
      ))}
    </div>
  );
}

function ProviderScheduledTasks({ inventory }: { inventory: AgentInventory }) {
  const tasks = inventory.scheduledTasks;
  return (
    <section className="card agent-provider-section">
      <header className="agent-provider-heading">
        <div>
          <span className={`badge ${providerBadges[inventory.provider]}`}>
            {providerLabels[inventory.provider]}
          </span>
          <strong>
            {tasks.length === 0
              ? "No scheduled tasks"
              : `${tasks.length} scheduled ${tasks.length === 1 ? "task" : "tasks"}`}
          </strong>
        </div>
        <span>{scheduledSourceLabels[inventory.provider]}</span>
      </header>
      {tasks.length === 0 ? (
        <div className="empty-state agent-empty-state">
          <p>{scheduledSourceLabels[inventory.provider]}.</p>
        </div>
      ) : (
        <div className="agent-capability-list">
          {tasks.map((task) => (
            <ScheduledTaskRow key={task.id} task={task} />
          ))}
        </div>
      )}
    </section>
  );
}

function ScheduledTaskRow({ task }: { task: ScheduledTask }) {
  const schedule = task.scheduleHuman ?? task.scheduleRaw;
  return (
    <div className="agent-capability-row">
      <div className="agent-capability-primary">
        <strong>{task.name}</strong>
        <span>
          {schedule ?? "Schedule not specified"}
          {task.scheduleMissing ? (
            <em className="agent-tasks-hint"> (not stored in config)</em>
          ) : null}
        </span>
        {task.model ? (
          <span>
            <code>{task.model}</code>
          </span>
        ) : null}
        {task.targetProject ? (
          <span>
            <code>{task.targetProject}</code>
          </span>
        ) : null}
      </div>
      <span
        className={`badge ${scheduledStatusBadges[task.status]} agent-status-tag`}
      >
        {scheduledStatusLabels[task.status]}
      </span>
      {task.instructionBody ? (
        <details className="agent-instruction agent-task-instruction">
          <summary>
            <strong>Instructions</strong>
            <span>{task.sourcePath}</span>
          </summary>
          <pre>{task.instructionBody}</pre>
        </details>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Write the UI test**

Add to the existing `describe` blocks in `src/components/agent-setup-view.test.tsx`. First, add a `scheduledTasks` field with one Codex task to the `inventories` codex fixture (replace its `scheduledTasks: []` from Task 1):

```ts
{
  provider: "codex",
  scope: "global",
  capabilities: [/* existing */],
  scheduledTasks: [
    {
      id: "weekly-digest",
      name: "Weekly digest",
      provider: "codex",
      scheduleRaw: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=8",
      scheduleHuman: "Mondays at 08:00",
      scheduleMissing: false,
      status: "active",
      model: "gpt-5.5",
      instructionBody: "Summarize the week.",
      instructionFormat: "toml_prompt",
      sourcePath: "/safe/.codex/automations/weekly-digest/automation.toml",
      warnings: [],
    },
  ],
  instructionFile: { /* existing */ },
  warnings: [],
},
```

Add a new test:

```ts
describe("Scheduled tasks view", () => {
  test("renders third tab and per-provider cards", () => {
    render(<AgentSetupView inventories={inventories} filters={parseAgentSetupFilters({ view: "tasks" })} />);
    const tabs = screen.getAllByRole("link", { name: /scheduled tasks/i });
    expect(tabs.length).toBeGreaterThan(0);
    expect(screen.getByText("Weekly digest")).toBeInTheDocument();
    expect(screen.getByText("Mondays at 08:00")).toBeInTheDocument();
    expect(screen.getByText("gpt-5.5")).toBeInTheDocument();
    // Pi empty card renders its note.
    expect(screen.getByText(/Pi does not expose scheduled tasks/i)).toBeInTheDocument();
  });

  test("parseAgentSetupFilters accepts view=tasks", () => {
    expect(parseAgentSetupFilters({ view: "tasks" }).view).toBe("tasks");
    expect(parseAgentSetupFilters({}).view).toBe("inventory");
  });
});
```

- [ ] **Step 6: Run the UI tests**

```bash
npx vitest run src/components/agent-setup-view.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Run full local verification**

```bash
npm run verify
```

Expected: lint, typecheck, format:check, test:run, build all pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/agent-setup-view.tsx src/components/agent-setup-view.test.tsx
git commit -m "✨ feat(agents): add Scheduled tasks tab to /agents"
```

---

## Task 9: Final verification + docs update

**Files:**
- Modify: `AGENTS.md` (the "Global agent setup inventory" paragraph — allowlist exception + new tab)
- Modify: `README.md` (the `/agents` table row)

- [ ] **Step 1: Update `AGENTS.md`**

Find the paragraph beginning `- Global agent setup inventory lives under \`src/lib/agent-inventory/\`` (around line 18). Update the allowlist sentence and add a sentence about the new tab. Replace:

> Provider readers must stay allowlist-based: return names, enabled/install status, packaging, provenance, repositories, safe paths, warnings, and global instruction Markdown, but never MCP commands/arguments/env, credentials, or raw config.

With:

> Provider readers must stay allowlist-based: return names, enabled/install status, packaging, provenance, repositories, safe paths, warnings, and global instruction Markdown, but never MCP commands/arguments/env, credentials, or raw config. **Exception:** scheduled-task readers (`discoverXxxScheduledTasks`) additionally surface each task's instruction body verbatim (Codex `prompt` from `~/.codex/automations/*/automation.toml`, Zcode `script_path` contents, Claude `SKILL.md` body) because that prose is the task's purpose and the user authored it. This is a deliberate, user-accepted tradeoff: a secret pasted into a prompt will render on `/agents`. Do not extend this exception to other capability kinds.

Also add a sentence to the same paragraph about the tab:

> The `/agents` page has three URL-backed tabs — Inventory, Compare, and Scheduled tasks; the third live-reads per-provider scheduled/recurring jobs (Codex automations, Claude scheduled-tasks dirs, Zcode `workflow_definition` rows, Pi none) under the same exception.

- [ ] **Step 2: Update `README.md`**

Find the `/agents` row in the pages table (around line 39). Replace its description:

> Agent setup — a live, read-only global inventory of plugins, skills, MCP servers, and instruction files for Codex, Claude Code, Zcode, and Pi. Compare opens a consensus-based Needs attention view, while Complete matrix preserves the full provider-by-provider inventory.

With:

> Agent setup — a live, read-only global inventory of plugins, skills, MCP servers, and instruction files for Codex, Claude Code, Zcode, and Pi. Three tabs: Inventory (per-provider capabilities), Compare (consensus Needs-attention view + full matrix), and Scheduled tasks (per-provider recurring jobs from Codex automations, Claude scheduled-tasks dirs, and Zcode workflow definitions).

- [ ] **Step 3: Run full local verification**

```bash
npm run verify
```

Expected: lint, typecheck, format:check, test:run, build all pass.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md README.md
git commit -m "📝 docs(agents): document Scheduled tasks tab and allowlist exception"
```

---

## Self-Review (completed during plan authoring)

**1. Spec coverage:**
- §2 Goal (third tab) → Task 8
- §3 Non-goals (no persistence/CRUD) → respected throughout, no DB writes
- §4 D1 (provider-native) → Tasks 4–7
- §4 D2 (third tab) → Task 8
- §4 D3 (humanized when parseable) → Task 2, applied in Task 4
- §4 D4 (empty card with note) → Task 8 (`ProviderScheduledTasks` empty branch)
- §4 D5 (verbatim prompt body + rule update) → Tasks 4/6 surface it; Task 9 updates AGENTS.md
- §4 D6 (Zcode script same treatment) → Task 6
- §5.2 data model → Task 1
- §5.3 readers → Tasks 4–7
- §5.4 humanizer → Task 2
- §5.5 wiring → each reader wires into its discoverer's return (Tasks 4–7)
- §6 UI → Task 8
- §7 allowlist update → Task 9
- §8 testing → Tasks 2, 3, 4, 5, 6, 8 (shared, schedule, discovery, view)

**2. Placeholder scan:** no TBDs/TODOs/“add appropriate …” in steps. Every code step has complete code.

**3. Type consistency:**
- `ScheduledTask` fields used in Task 8 (`scheduleHuman`, `scheduleRaw`, `scheduleMissing`, `instructionBody`, `instructionFormat`, `sourcePath`, `model`, `targetProject`, `status`) all match Task 1's type definition.
- `discoverCodexScheduledTasks(homeDir)`, `discoverClaudeScheduledTasks(homeDir)`, `discoverZcodeScheduledTasks()`, `discoverPiScheduledTasks()` signatures consistent across Tasks 4–7.
- `humanizeSchedule(raw: string): string | undefined` consistent between Task 2 definition and Task 4 use.
- `listZcodeWorkflowDefinitions(): ZcodeWorkflowDefinition[] | undefined` consistent between Task 6's zcode-db addition and zcode.ts use.
