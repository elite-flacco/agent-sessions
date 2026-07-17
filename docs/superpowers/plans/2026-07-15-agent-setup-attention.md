# Agent Setup Attention View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a consensus-based Needs attention comparison while preserving the complete Agent setup matrix and its legacy discrepancy URL.

**Architecture:** Extend normalized comparison rows with a server-derived assessment and stable reason, then make the existing server-rendered comparison view select between actionable and complete URL-backed modes. Keep discovery, provider readers, and the allowlist privacy boundary unchanged; reduce matrix density by spanning unanimous rows across all provider columns.

**Tech Stack:** Next.js 16 App Router, React 19 server components, TypeScript, Vitest, Testing Library, Tailwind 4 semantic component classes.

## Global Constraints

- Evaluate plugins, skills, MCPs, and global instructions.
- The primary Compare link opens `view=compare&comparison=attention`; `view=compare` remains the complete matrix.
- Preserve `discrepancies=1` as the original broad discrepancy filter.
- Never expose MCP commands, arguments, environment variables, credentials, or raw configuration.
- Use only semantic tokens and component classes from `src/app/globals.css`; no raw Tailwind palette colors, arbitrary values, inline styles, or `dark:` variants.
- Run the complete `npm run verify` command and browser-check desktop and mobile before completion.
- Preserve unrelated modified and untracked files in the worktree.

---

### Task 1: Derive consensus assessments

**Files:**

- Modify: `src/lib/agent-inventory/types.ts`
- Modify: `src/lib/agent-inventory/normalize.ts`
- Test: `src/lib/agent-inventory/normalize.test.ts`

**Interfaces:**

- Consumes: `AgentInventory[]`, `AgentCapability`, and `buildComparisonRows(inventories: AgentInventory[]): ComparisonRow[]`.
- Produces: `ComparisonAssessment`, `ComparisonAssessmentReason`, `ComparisonRow.assessment`, and `ComparisonRow.isUniformAcrossProviders`.

- [ ] **Step 1: Write failing assessment tests**

Add fixture helpers and focused tests covering unavailable precedence, 3–1 missing presence, 2–2 presence, four-provider signature drift, unique provider context, consistent context, missing instructions, and differing instruction fingerprints:

```ts
expect(row.assessment).toEqual({
  level: "fix",
  reason: "missing_from_one_provider",
  message: "Present on 3 of 4 agents; missing from Pi.",
});
expect(row.isUniformAcrossProviders).toBe(false);
```

Retain an assertion that `row.isDiscrepancy` keeps its original broad semantics for provider-unique capabilities.

- [ ] **Step 2: Run the model tests and confirm failure**

Run: `npm run test:run -- src/lib/agent-inventory/normalize.test.ts`

Expected: FAIL because `assessment` and `isUniformAcrossProviders` do not exist.

- [ ] **Step 3: Add explicit comparison assessment types**

Add to `src/lib/agent-inventory/types.ts`:

```ts
export type ComparisonAssessmentLevel = "fix" | "review" | "context";
export type ComparisonAssessmentReason =
  | "unavailable"
  | "missing_instruction"
  | "missing_from_one_provider"
  | "split_presence"
  | "configuration_drift"
  | "instruction_drift"
  | "provider_specific"
  | "consistent";

export interface ComparisonAssessment {
  level: ComparisonAssessmentLevel;
  reason: ComparisonAssessmentReason;
  message: string;
}
```

Extend `ComparisonRow` with `assessment: ComparisonAssessment` and `isUniformAcrossProviders: boolean`.

- [ ] **Step 4: Implement consensus derivation**

Keep `comparisonSignature` canonical. Add provider-list formatting and assessment helpers with this precedence:

```ts
function assessCapabilityRow(row: ComparisonRow): ComparisonAssessment {
  const present = agentProviders.filter((provider) => row.cells[provider]);
  const unavailable = present.filter(
    (provider) => row.cells[provider]?.status === "unavailable",
  );
  if (unavailable.length > 0) {
    return {
      level: "fix",
      reason: "unavailable",
      message: `Unavailable on ${formatProviderList(unavailable)}.`,
    };
  }
  if (present.length === 3) {
    const missing = agentProviders.filter((provider) => !row.cells[provider]);
    return {
      level: "fix",
      reason: "missing_from_one_provider",
      message: `Present on 3 of 4 agents; missing from ${formatProviderList(missing)}.`,
    };
  }
  if (present.length === 2) {
    return {
      level: "review",
      reason: "split_presence",
      message: "Present on 2 of 4 agents; review whether parity is intended.",
    };
  }
  if (present.length === 1) {
    return {
      level: "context",
      reason: "provider_specific",
      message: `Only found on ${formatProviderList(present)}.`,
    };
  }
  const signatures = new Set(
    present.map((provider) => comparisonSignature(row.cells[provider]!)),
  );
  return signatures.size > 1
    ? {
        level: "review",
        reason: "configuration_drift",
        message: "Installed across all agents with differing configuration.",
      }
    : {
        level: "context",
        reason: "consistent",
        message: "Consistent across all agents.",
      };
}
```

Assess instructions separately: any missing provider is `fix / missing_instruction`; differing fingerprints are `review / instruction_drift`; otherwise `context / consistent`. Set `isUniformAcrossProviders` only for non-instruction rows present on all four providers with one signature. Preserve `isDiscrepancy` unchanged.

- [ ] **Step 5: Run focused model tests**

Run: `npm run test:run -- src/lib/agent-inventory/normalize.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the assessment model**

```bash
git add src/lib/agent-inventory/types.ts src/lib/agent-inventory/normalize.ts src/lib/agent-inventory/normalize.test.ts
git commit -m "feat(agents): derive comparison attention levels"
```

### Task 2: Add Needs attention and compact matrix presentation

**Files:**

- Modify: `src/components/agent-setup-view.tsx`
- Modify: `src/app/globals.css`
- Test: `src/components/agent-setup-view.test.tsx`

**Interfaces:**

- Consumes: `ComparisonRow.assessment`, `ComparisonRow.isUniformAcrossProviders`, URL filters, and `setupHref`.
- Produces: `AgentSetupFilters.comparisonMode`, mode links, assessment counts/reasons, actionable ordering, and compact unanimous rows.

- [ ] **Step 1: Read installed Next.js navigation guidance**

Read the App Router Link and page `searchParams` documentation under `node_modules/next/dist/docs/01-app/`. Keep `searchParams` awaited in `src/app/agents/page.tsx` and continue using `next/link` for server-rendered switches.

- [ ] **Step 2: Write failing UI tests**

Test parsing and rendering:

```ts
expect(
  parseAgentSetupFilters({ view: "compare", comparison: "attention" }),
).toMatchObject({ view: "compare", comparisonMode: "attention" });
```

Assert that the primary Compare tab links to attention; attention includes Fix and Review but excludes provider-specific and consistent rows; complete mode includes all rows; `discrepancies=1` still uses `isDiscrepancy`; Fix sorts before Review; counts and reasons render; unanimous capability rows contain one `colspan="4"` cell and “All agents”; divergent rows retain provider cells; and the no-attention state links to Complete matrix.

- [ ] **Step 3: Run UI tests and confirm failure**

Run: `npm run test:run -- src/components/agent-setup-view.test.tsx`

Expected: FAIL because the new mode and compact row do not exist.

- [ ] **Step 4: Add URL-backed comparison modes**

Extend filters:

```ts
export interface AgentSetupFilters {
  view: AgentSetupViewMode;
  comparisonMode?: "attention";
  q?: string;
  provider?: AgentProvider;
  kind?: AgentSetupKind;
  status?: CapabilityStatus;
  discrepanciesOnly?: boolean;
}
```

Parse `comparison=attention`, serialize it in `setupHref`, clear comparison-only keys when switching to Inventory, and make the main Compare link set `comparisonMode: "attention"` while clearing `discrepanciesOnly`. Render Needs attention and Complete matrix links inside Compare. Keep Discrepancies only only in Complete matrix.

- [ ] **Step 5: Filter, summarize, and order rows**

Apply search/type/provider/status filters to rows already assessed from all inventories. Count Fix and Review rows before applying display mode. In attention mode retain those levels and sort with:

```ts
const assessmentOrder = { fix: 0, review: 1, context: 2 } as const;
```

Then sort by level, explicit kind order including instructions, and name. Render semantic Fix/Review badges plus `row.assessment.message` in the sticky capability cell. Show a positive empty state with a Complete matrix link when no actionable rows remain.

- [ ] **Step 6: Collapse unanimous rows**

For `row.isUniformAcrossProviders`, render one `<td colSpan={agentProviders.length}>` with a disclosure labeled “All agents · {status}” and one safe provenance copy. Otherwise preserve provider cells and missing markers. Keep instruction cells independently expandable.

- [ ] **Step 7: Add semantic styles**

Read the existing agent classes in `src/app/globals.css`. Add named classes for the mode switcher, attention summary, assessment badge/reason, and unanimous summary using existing semantic variables only. Preserve the sticky column and `min-width: 58rem` matrix. At 640px, allow the toolbar and summary to wrap without body overflow.

- [ ] **Step 8: Format and run focused tests**

Run:

```bash
npx prettier --write src/components/agent-setup-view.tsx src/components/agent-setup-view.test.tsx src/app/globals.css src/lib/agent-inventory/types.ts src/lib/agent-inventory/normalize.ts src/lib/agent-inventory/normalize.test.ts
npm run test:run -- src/components/agent-setup-view.test.tsx src/lib/agent-inventory/normalize.test.ts
```

Expected: both test files PASS.

- [ ] **Step 9: Commit the comparison UI**

```bash
git add src/components/agent-setup-view.tsx src/components/agent-setup-view.test.tsx src/app/globals.css
git commit -m "feat(agents): add needs attention comparison"
```

### Task 3: Document, verify, and browser-review

**Files:**

- Modify: `README.md`
- Review and modify if necessary: `AGENTS.md`
- Review and modify if necessary: `CLAUDE.md`
- Modify if non-conflicting: `docs/reviews/2026-07-15-ux-review.md`

**Interfaces:**

- Consumes: completed comparison behavior.
- Produces: user-facing documentation, accurate architecture notes, review status, and verification evidence.

- [ ] **Step 1: Update user documentation**

Explain in the existing README Agent setup section that Compare opens a consensus-based Needs attention view, Complete matrix preserves provider-specific context, and Fix/Review labels are heuristics rather than mutations.

- [ ] **Step 2: Review architecture documentation**

Review `AGENTS.md` and `CLAUDE.md`. If warranted, add one concise sentence that assessments derive from all four global inventories and never change discovery or expose raw configuration. Do not duplicate the heuristic table in always-loaded instructions.

- [ ] **Step 3: Update the UX review without overwriting user edits**

Inspect the current review diff. If section 7 can be edited cleanly, mark both findings fixed and summarize the two modes plus compact unanimous rows. If overlap is ambiguous, leave it untouched and report that exact item.

- [ ] **Step 4: Run full verification**

Run: `npm run verify`

Expected: lint, typecheck, format check, all Vitest tests, and build PASS. If format check reports unrelated pre-existing Markdown or `.zcode/plans/*` drift, verify changed files separately and report exact baseline failures without modifying unrelated files.

- [ ] **Step 5: Browser-verify `/agents`**

Start `npm run dev`. Verify desktop and 390px mobile: primary Compare opens Needs attention; Fix/Review counts match rows; Complete matrix retains all rows and legacy discrepancy filtering; unanimous rows use one All agents disclosure; filters preserve expected query parameters; empty attention links to Complete matrix; the matrix scrolls internally with a legible sticky column and no body overflow; keyboard focus reaches links/disclosures; and the console has no introduced errors.

- [ ] **Step 6: Commit documentation**

Stage only changed task files and commit:

```bash
git add README.md AGENTS.md CLAUDE.md docs/reviews/2026-07-15-ux-review.md
git commit -m "docs: document agent comparison guidance"
```

Omit unchanged or intentionally preserved files.

- [ ] **Step 7: Review final scope**

Run:

```bash
git status --short --branch
git diff HEAD~3 -- src/lib/agent-inventory src/components/agent-setup-view.tsx src/components/agent-setup-view.test.tsx src/app/globals.css README.md AGENTS.md CLAUDE.md docs/reviews/2026-07-15-ux-review.md
```

Confirm only the assessment model, two modes, compact presentation, tests, and related documentation changed. Report unrelated dirty files separately.
