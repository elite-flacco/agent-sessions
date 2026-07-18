# Scheduled Tasks Tab — Design Spec

**Date:** 2026-07-18
**Status:** Draft, pending user review
**Author:** brainstorming session (ZCode + user)
**Scope:** One new tab on `/agents`, plus per-provider readers. No SQLite changes. No new build infra.

---

## 1. Problem

Each of the four supported coding agents (Codex, Claude Code, Zcode, Pi) can have recurring/scheduled jobs configured on disk, but there is no place in Relay to see them. Today a user has to know that Codex stores automations in `~/.codex/automations/*/automation.toml`, Claude stores them as skill-shaped dirs under `~/.claude/scheduled-tasks/`, and Zcode stores them as rows in `~/.zcode/cli/db/db.sqlite:workflow_definition` — three different locations, three different shapes. Pi has no scheduled-task concept today.

The `/agents` page already does live, allowlist-based discovery of capabilities (plugins/skills/MCPs) per provider. Scheduled tasks are a natural fourth category to surface alongside them, using the same read-only, never-persisted boundary.

## 2. Goal

Add a third URL-backed tab — **"Scheduled tasks"** — to `/agents`, parallel to Inventory and Compare. It shows, per provider, every scheduled/recurring task that provider has configured, with safe metadata and (per user decision §6) the full instruction body in a detail panel. Empty providers render an empty card with a note. No CRUD, no runner, no persistence.

## 3. Non-goals

- No editing, creating, deleting, enabling, or disabling scheduled tasks. Read-only.
- No executing scheduled tasks from Relay.
- No joining scheduled tasks into the Compare matrix (capabilities and tasks have different shapes — see §9, rejected alternative).
- No persistence to SQLite. Like the rest of `/agents`, this is a live filesystem/database read on every request.
- No project-scoped scheduled tasks. Only the global scope (`{ kind: "global" }`), matching the rest of the inventory today.
- No support for providers beyond Codex/Claude/Zcode/Pi.

## 4. Decisions (locked during brainstorming)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Source of truth:** provider-native schedule files/dbs, discovered per-provider | Faithful to existing `/agents` live-read architecture; surfaces what the provider itself honors |
| D2 | **Surface as:** third URL-backed tab "Scheduled tasks", parallel to Inventory/Compare | Mirrors the established tab pattern; smallest faithful extension |
| D3 | **Schedule display:** humanized when parseable, native string fallback, "Not specified" when absent | Balances readability across the very different field shapes |
| D4 | **Empty provider:** empty card with informational note (consistent with Inventory) | Shows we looked; doesn't hide that Pi/Zcode-on-this-machine have none |
| D5 | **Instruction body:** surface verbatim in a collapsible detail panel; **update `AGENTS.md:18` to carve out scheduled-task prompts as an explicit exception** to the allowlist rule. Zcode `script_path` contents treated identically | User chose verbatim over redaction; we record the rule change explicitly so the contract stays honest |
| D6 | **Zcode script:** read `script_path` file contents and surface verbatim (same treatment as Codex prompt) | User confirmed symmetric treatment |

> ⚠️ **D5 carries a security tradeoff the user accepted.** Verbatim prompt bodies can contain pasted tokens, emails, internal URLs, or `KEY=value` secrets. Surfacing them on a web dashboard means a secret pasted into a Codex prompt will render in `/agents`. Mitigations are intentionally **out of scope** for this spec per the user's explicit choice; the only safeguard is updating `AGENTS.md:18` to document the exception so future maintainers understand the boundary moved.

## 5. Architecture

### 5.1 Where it lives

All new code lives under `src/lib/agent-inventory/` — the same boundary that already reads capabilities. No new top-level directories, no schema files touched, no `src/db/` changes, no `src/lib/queries.ts` changes.

```
src/lib/agent-inventory/
  types.ts            # +ScheduledTask, +AgentInventory.scheduledTasks
  shared.ts           # +helpers (readToml, parseSkillFrontmatter, etc.) as needed
  codex.ts            # +discoverCodexScheduledTasks()
  claude.ts           # +discoverClaudeScheduledTasks()
  zcode.ts            # +discoverZcodeScheduledTasks()
  pi.ts               # +discoverPiScheduledTasks() -> always []
  index.ts            # wire new discoverers into Promise.all
  schedule.ts         # NEW: humanizeSchedule() + rrule/iso parse helpers
  normalize.ts        # no changes (tasks are NOT part of comparison)
```

### 5.2 Data model (`types.ts`)

A new parallel array on `AgentInventory`, **not** a new `CapabilityKind`. Capabilities and tasks have different shapes (tasks have schedule, target, prompt body; capabilities have packaging, origin, provenance) and folding them together would distort both.

```ts
export interface ScheduledTask {
  id: string;                          // provider-scoped stable id (Codex automation id, Claude dir name, Zcode workflow id)
  name: string;                        // human label (Codex `name`, Claude frontmatter `name`, Zcode `name`)
  description?: string;                // Claude frontmatter `description`, Codex `prompt` first line, Zcode meta_json summary — when present
  provider: AgentProvider;             // "codex" | "claude" | "zcode" | "pi"
  scheduleRaw?: string;                // native field verbatim (Codex rrule, Zcode meta_json schedule)
  scheduleHuman?: string;              // humanized when parseable, else undefined
  scheduleMissing: boolean;            // true when provider doesn't store a schedule in-file (Claude, or any future case)
  status: ScheduledTaskStatus;         // "active" | "paused" | "disabled" | "unknown"
  model?: string;                      // Codex `model`, when present
  targetProject?: string;              // Codex `target.project_id`, when present (id only — safe-ish metadata)
  workingDirectories?: string[];       // Codex `cwds`, Zcode meta cwd, when present
  instructionBody?: string;            // Codex `prompt`, Zcode script file contents, Claude SKILL.md body — verbatim, per D5/D6
  instructionFormat: "markdown" | "toml_prompt" | "skill_md" | "script";  // how to render instructionBody
  sourcePath: string;                  // safe path to the source (existing allowlist category)
  createdAt?: number;                  // epoch ms when provider recorded it
  updatedAt?: number;                  // epoch ms when provider last updated it
  lastRunAt?: number;                  // epoch ms of last execution, when provider records it
  warnings: InventoryWarning[];        // per-task parse warnings (malformed toml, missing file, etc.)
}

export type ScheduledTaskStatus = "active" | "paused" | "disabled" | "unknown";

// Extend existing AgentInventory:
export interface AgentInventory {
  provider: AgentProvider;
  scope: "global";
  capabilities: AgentCapability[];
  scheduledTasks: ScheduledTask[];      // NEW — always defined, may be []
  instructionFile?: InstructionFile;
  warnings: InventoryWarning[];
}
```

### 5.3 Per-provider readers

Each reader returns `ScheduledTask[]`. Empty array when the provider has nothing or its storage doesn't exist. Never throws — parse failures become `InventoryWarning`s on the inventory (existing pattern) and skipped tasks.

#### Codex — `discoverCodexScheduledTasks()`
- Reads `~/.codex/automations/*/automation.toml` (one TOML file per task).
- Reuses the existing small TOML table parser already in `codex.ts` if it can handle key/values and arrays; if not, extend it minimally. **Do not** add a TOML dependency — the file format is simple and codex.ts already parses `config.toml` by hand.
- Fields mapped:
  - `id` ← `id`
  - `name` ← `name`
  - `description` ← first non-empty line of `prompt`
  - `scheduleRaw` ← `rrule`
  - `scheduleHuman` ← `humanizeSchedule(rrule)` (rrule parser — see §5.4)
  - `status` ← map `"ACTIVE"` → `"active"`, `"PAUSED"` → `"paused"`, anything else → `"unknown"`
  - `model` ← `model`
  - `targetProject` ← `target.project_id`
  - `workingDirectories` ← `cwds` (array)
  - `instructionBody` ← `prompt` (verbatim — D5)
  - `instructionFormat` ← `"toml_prompt"`
  - `sourcePath` ← the automation.toml path
  - `createdAt` / `updatedAt` ← `created_at` / `updated_at` (epoch ms)
  - `lastRunAt` ← not in automation.toml; **do not** query `agent_jobs`/`agent_job_items` (those are batch jobs, not scheduled automations — confirmed during discovery: `agent_jobs` is empty on this machine while `automations/` has 6 entries)

#### Claude — `discoverClaudeScheduledTasks()`
- Reads `~/.claude/scheduled-tasks/*/` — one directory per task. Each contains a `SKILL.md` with YAML frontmatter (`name`, `description`).
- Fields mapped:
  - `id` ← directory name
  - `name` ← frontmatter `name`, fallback to directory name
  - `description` ← frontmatter `description`
  - `scheduleRaw` ← **undefined** (Claude doesn't store the schedule in-file — the dir name like `daily-pr-triage` is just a hint, not a parseable schedule)
  - `scheduleHuman` ← **undefined**
  - `scheduleMissing` ← `true`
  - `status` ← `"active"` (Claude scheduled-tasks have no status field in the file; treat presence as active)
  - `instructionBody` ← SKILL.md body (verbatim — D5)
  - `instructionFormat` ← `"skill_md"`
  - `sourcePath` ← the SKILL.md path
- Also scans `~/.claude/tasks/` for one-shot (non-recurring) tasks and **excludes** them — only `scheduled-tasks/` counts. (Discovered during exploration: `tasks/` holds session-scoped UUID dirs, not scheduled jobs.)

#### Zcode — `discoverZcodeScheduledTasks()`
- Reads `workflow_definition` table from `~/.zcode/cli/db/db.sqlite` (read-only, same pattern as `src/lib/zcode-db.ts`).
- Fields mapped:
  - `id` ← `id`
  - `name` ← `name`
  - `status` ← `enabled = 1` → `"active"` (or `"disabled"` when 0); `trusted` does not affect status
  - `instructionBody` ← contents of `script_path` file, read from disk (verbatim — D6)
  - `instructionFormat` ← `"script"`
  - `sourcePath` ← `script_path`
  - `createdAt` / `updatedAt` ← `time_created` / `time_updated`
  - **Schedule: v1 always sets `scheduleMissing: true`** (no `scheduleRaw`, no `scheduleHuman`). The `meta_json` shape is unobservable on this machine (the table has 0 rows), so v1 does not guess at key names. When the first real `workflow_definition` row appears, a follow-up can inspect `meta_json`, add a parser to `schedule.ts`, and populate the fields. This keeps v1 honest about what we can actually read.
- Returns `[]` when the table is empty (the case on this machine today) — the empty card handles display.
- **Does NOT read `~/.zcode/v2/tasks-index.sqlite`** — confirmed during discovery that its `tasks` table (42 rows on this machine) holds interactive build-mode sessions (`mode = 'build'`, `provider`, `model`), not scheduled/recurring tasks. Only `workflow_definition` is the scheduled-task analog.
- Test seam `ZCODE_DB_PATH` is **already** established for the inventory reader to reuse — no new env var.

#### Pi — `discoverPiScheduledTasks()`
- Returns `[]` unconditionally. Pi has no scheduled-task concept today (confirmed during discovery: `~/.pi/agent/` has only settings/sessions/skills/bin).
- The empty card renders with the note "Pi does not expose scheduled tasks."

### 5.4 Schedule humanization (`schedule.ts`)

New file. Exports `humanizeSchedule(raw: string): string | undefined`.

- **Codex rrule** (`FREQ=WEEKLY;BYDAY=MO;BYHOUR=8;BYMINUTE=0;BYSECOND=0`):
  - Hand-rolled parser, no `rrule` library. Handles the subset Codex actually emits: `FREQ` ∈ {DAILY, WEEKLY, MONTHLY}, optional `BYDAY` (one or more of MO/TU/WE/TH/FR/SA/SU), optional `BYHOUR`/`BYMINUTE`.
  - Output: `"Mondays at 08:00"`, `"Daily at 09:30"`, `"Monthly on the 1st at 00:00"` (BYMONTHDAY if present).
  - Returns `undefined` when the rrule doesn't match the supported subset — caller falls back to `scheduleRaw`.
- **Zcode**: no schedule is parsed in v1 — see §5.3 Zcode reader (`scheduleMissing: true`). When a real `meta_json` shape is observed in a follow-up, this is where its parser would go.
- **Claude**: no raw string → `scheduleMissing: true`, `scheduleHuman: undefined`. The view shows "Not specified" with a tooltip explaining Claude doesn't store schedules in-file.

Time zone handling: schedules are wall-clock in the user's local tz (Codex `BYHOUR=8` means 8am local). Humanized output uses 24-hour `HH:MM` to avoid am/pm ambiguity; no tz conversion.

### 5.5 Wiring (`index.ts`)

`getAgentInventories()` currently does `Promise.all` over four discoverers returning `AgentInventory`. Each discoverer gains a sibling call to its `discoverXxxScheduledTasks()`; the two results are merged into the single `AgentInventory` (capabilities + scheduledTasks + instructionFile + warnings). Failures in either become `InventoryWarning`s on the same inventory, never thrown.

## 6. UI

### 6.1 Tab wiring (`src/components/agent-setup-view.tsx`)

- Extend `AgentSetupViewMode` (line 27): `"inventory" | "compare" | "tasks"`.
- Extend `parseAgentSetupFilters` (line 130): `view` is `"tasks"` when `params.view === "tasks"`.
- Add a third `<Link>` in the `workspace-switcher` `<nav>` (line 232): label **"Scheduled tasks"**, `setupHref(filters, { view: "tasks" })`, same `workspace-tab` / `tab-active` classes.
- Add a third branch (line 267): `filters.view === "tasks"` renders `<ScheduledTasksView inventories={inventories} filters={filters} />`.
- `FilterForm` hidden inputs (line 330): the existing single hidden `view` input already round-trips whatever value is active, so no change needed there beyond confirming it serializes `"tasks"`. Verify the form action auto-submits don't reset to inventory.

### 6.2 `ScheduledTasksView` component

New component, lives in `agent-setup-view.tsx` next to `InventoryView`/`ComparisonView` (or a sibling file if that file is getting large — decision during implementation).

Layout:
- Page-level summary line: total tasks across all providers, plus per-provider count chips.
- One card per provider in `agentProviders` order (Codex, Claude, Zcode, Pi) — always four cards, even when empty.
- Each card header: provider label, task count, source-path hint (e.g. "Read from `~/.codex/automations/`").
- Each card body: list of `ScheduledTaskRow`s, or the empty-state note.

`ScheduledTaskRow` shows:
- **Name** (bold) + status badge (`active` / `paused` / `disabled` / `unknown`)
- **Schedule**: `scheduleHuman` when present, else `scheduleRaw` when present, else "Not specified" with an info tooltip (Claude case)
- **Model** (when present) — small monospace chip
- **Target / working dirs** (when present) — truncated, title-attr full
- **Last updated** (when present) — relative time
- **Detail disclosure** (`<details>`) labeled "Instructions": renders `instructionBody` according to `instructionFormat`. Reuses the existing markdown rendering path if one exists for instruction files; otherwise a `<pre>` with wrapping. Per D5 this is verbatim — **no redaction**.

Empty-state note copy (per provider):
- Codex: "No automations configured in `~/.codex/automations/`."
- Claude: "No scheduled tasks in `~/.claude/scheduled-tasks/`."
- Zcode: "No workflow definitions in `~/.zcode/cli/db/db.sqlite`."
- Pi: "Pi does not expose scheduled tasks."

### 6.3 Styling

Per `AGENTS.md:20`: semantic tokens and component classes from `src/app/globals.css` only. No raw Tailwind palette colors, arbitrary values, inline styles, or `dark:` variants. Reuse existing card/badge/chip classes. Status badges map to existing semantic status classes if present; if not, plain text labels (do **not** invent new color classes).

### 6.4 Filters

The existing filter form (provider/kind/status/q) does not apply cleanly to tasks (no `kind`, no `status` matching the capability vocab). For the first cut, the tasks view **ignores** the filter form — the summary line and per-provider cards are the only navigation. The `provider` filter from the URL can optionally scope to one card but is not required for v1. The `view=tasks` param still round-trips so switching tabs preserves nothing-extra.

## 7. Allowlist rule update (D5)

`AGENTS.md:18` currently reads:

> Provider readers must stay allowlist-based: return names, enabled/install status, packaging, provenance, repositories, safe paths, warnings, and global instruction Markdown, but never MCP commands/arguments/env, credentials, or raw config.

Update to add a scoped exception:

> …never MCP commands/arguments/env, credentials, or raw config. **Exception:** scheduled-task readers (`discoverXxxScheduledTasks`) additionally surface the task's instruction body verbatim (Codex `prompt`, Zcode `script_path` contents, Claude `SKILL.md` body), because that prose is the task's purpose and the user authored it. This is a deliberate, user-accepted tradeoff: a secret pasted into a prompt will render on `/agents`. Do not extend this exception to other capability kinds.

Also update the `/agents` sentence on the same line to mention the new tab.

## 8. Testing

Mirror the existing inventory test patterns:

- **`src/lib/agent-inventory/discovery.test.ts`** (or a new `scheduled-tasks.test.ts`):
  - Codex: feed a fixture `automations/foo/automation.toml` (via a temp `HOME` or a path-injection seam), assert `ScheduledTask` shape, rrule → human conversion, status mapping, prompt body surfaced verbatim.
  - Claude: fixture `scheduled-tasks/daily-pr-triage/SKILL.md`, assert frontmatter parsing, `scheduleMissing: true`, body surfaced.
  - Zcode: fixture `db.sqlite` with a `workflow_definition` row pointing at a temp script file, assert fields; empty table → `[]`.
  - Pi: assert unconditional `[]`.
- **`schedule.test.ts`**: rrule parser cases (daily/weekly/monthly, multi-day, with/without time, unsupported → returns `undefined`).
- **`src/components/agent-setup-view.test.tsx`**: extend to cover `view=tasks` — third tab renders, empty cards render notes, a populated fixture shows rows + detail disclosure. The existing `view=compare` tests are the template.

All tests use the established seams: `CODEX_STATE_DB_PATH` is not needed (we read files, not codex sqlite); `ZCODE_DB_PATH` for the Zcode reader; `RELAY_PERSONAL_SKILL_ROOTS` and temp `HOME` for Codex/Claude file reads.

## 9. Rejected alternatives

- **Integrate tasks into Compare as a new capability kind** — rejected. `normalize.ts` hardcodes "N of 4 agents" messaging that assumes homogeneous capability kinds, and tasks have schedule/status/prompt fields that don't fit `AgentCapability`. Folding them in would distort both. (D2)
- **Relay-managed tasks with SQLite persistence + CRUD + runner** — rejected at the first question. Out of scope; the user explicitly chose provider-config discovery.
- **Redact prompt bodies before display** — rejected by user (D5). The spec records this as an accepted tradeoff and the only mitigation is documenting the rule change.
- **Hide empty providers** — rejected (D4). Showing empty cards communicates "we looked, Pi has none," which hiding would lose.
- **Schedule displayed as raw only** — rejected (D3). Humanized when parseable is more useful; raw is the fallback.
- **Reading Codex `agent_jobs`/`agent_job_items` for last-run info** — rejected. Those are batch jobs (CSV in/out), not scheduled automations; they're empty on this machine while `automations/` has 6 entries. Conflating them would mislead.

## 10. Out of scope / future

- Project-scoped scheduled tasks (when `InventoryScope` gains a `{ kind: "project" }` variant).
- Editing/enabling/disabling tasks from Relay.
- A "last run" / "next run" column — requires either polling the provider's run history (Codex `automations/*/memory.md` has some of this; Zcode `workflow_run`/`workflow_activity` have it) or executing, both out of scope for v1. `lastRunAt` is in the type as an optional for forward-compat but no reader populates it in v1.
- Redaction of prompt bodies — explicitly deferred per D5.

## 11. Files touched (summary)

| File | Change |
|---|---|
| `src/lib/agent-inventory/types.ts` | +`ScheduledTask`, +`ScheduledTaskStatus`, +`AgentInventory.scheduledTasks` |
| `src/lib/agent-inventory/shared.ts` | helpers as needed (TOML parse reuse, frontmatter parse) |
| `src/lib/agent-inventory/codex.ts` | +`discoverCodexScheduledTasks()` |
| `src/lib/agent-inventory/claude.ts` | +`discoverClaudeScheduledTasks()` |
| `src/lib/agent-inventory/zcode.ts` | +`discoverZcodeScheduledTasks()` |
| `src/lib/agent-inventory/pi.ts` | +`discoverPiScheduledTasks()` → `[]` |
| `src/lib/agent-inventory/index.ts` | wire new discoverers into the `Promise.all` |
| `src/lib/agent-inventory/schedule.ts` | NEW — `humanizeSchedule()` + rrule parser |
| `src/components/agent-setup-view.tsx` | +third tab, +`ScheduledTasksView` + `ScheduledTaskRow` |
| `src/lib/agent-inventory/scheduled-tasks.test.ts` (or extend `discovery.test.ts`) | NEW — per-provider reader tests |
| `src/lib/agent-inventory/schedule.test.ts` | NEW — rrule parser tests |
| `src/components/agent-setup-view.test.tsx` | extend for `view=tasks` |
| `AGENTS.md` | update line 18 (allowlist exception for scheduled-task prompts) + `/agents` description |
| `README.md` | update `/agents` description to mention the Scheduled tasks tab |

No changes to: `src/db/`, `drizzle/`, `src/lib/queries.ts`, `src/lib/pricing.ts`, `src/components/sidebar.tsx`, any collector/adapter code.
