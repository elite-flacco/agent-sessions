# Agent Inventory Category Disclosures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every source category in Agent Setup Inventory independently expandable and collapsible, open by default.

**Architecture:** Convert the existing `CatalogSourceGroup` wrapper into a native HTML disclosure. Its current heading becomes the summary and its current body remains the collapsible content, preserving category grouping, nested plugin disclosures, selection, and navigation behavior.

**Tech Stack:** Next.js, React, TypeScript, native HTML `<details>`/`<summary>`, Tailwind CSS v4 global component styles, Vitest, Testing Library.

## Global Constraints

- Every rendered source category starts expanded.
- Selecting the category heading toggles only that category's capability rows.
- Plugin skill groups remain independently expandable inside the Plugin-provided category.
- Compare, Scheduled, capability selection, and the inspector remain unchanged.
- Reuse Relay's semantic design tokens; add no raw Tailwind palette colors, arbitrary values, static inline styles, or `dark:` variants.
- Preserve all unrelated working-tree changes.
- Do not commit unless the user explicitly requests it.
- Completion requires the repository Definition of Done in `docs/superpowers/plan-dod.md`.

---

### Task 1: Add category disclosure behavior

**Files:**

- Modify: `src/components/agent-setup-view.test.tsx`
- Modify: `src/components/agent-setup-view.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**

- Consumes: `CatalogSourceGroup({ source, capabilities, filters, duplicateNames, selectedId })` and existing `.agent-source-group-*` styles.
- Produces: one open native disclosure per rendered source category; no public TypeScript interface changes.

- [ ] **Step 1: Write the failing component assertions**

Extend `skills inventory renders semantic source groups and compact aligned rows` to assert that every `.agent-source-group` is a native disclosure, starts open, and contains its heading and body:

```tsx
const sourceGroups = container.querySelectorAll("details.agent-source-group");
expect(sourceGroups).toHaveLength(5);
for (const group of sourceGroups) {
  expect(group.hasAttribute("open")).toBe(true);
  expect(
    group.querySelector(":scope > summary.agent-source-group-heading"),
  ).not.toBeNull();
  expect(
    group.querySelector(":scope > .agent-source-group-body"),
  ).not.toBeNull();
}
```

Keep the existing nested plugin test and assert that `.agent-plugin-group` remains inside `details.agent-source-group`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
npx vitest run src/components/agent-setup-view.test.tsx -t "skills inventory renders semantic source groups|plugin-provided skills"
```

Expected: FAIL because `.agent-source-group` is currently a `<section>` and the heading is currently a `<header>`.

- [ ] **Step 3: Implement the native disclosure**

In `CatalogSourceGroup`, replace only the outer category structure:

```tsx
<details className="agent-source-group" open>
  <summary className="agent-source-group-heading">
    {/* Preserve the existing icon, title, description, and count. */}
  </summary>
  <div className="agent-source-group-body">
    {/* Preserve existing plugin grouping and capability rows. */}
  </div>
</details>
```

Update the existing `.agent-source-group-heading` rules in `globals.css` to remove the browser marker, add a token-backed hover state and disclosure chevron, and rotate the chevron for `[open]`. Reuse the existing focus-visible rule and the current category spacing, typography, and responsive selectors.

- [ ] **Step 4: Run the focused Agent Setup tests**

Run:

```bash
npx vitest run src/components/agent-setup-view.test.tsx
```

Expected: all Agent Setup tests pass.

- [ ] **Step 5: Run focused lint, formatting, and type checks**

Run:

```bash
npx eslint src/components/agent-setup-view.tsx src/components/agent-setup-view.test.tsx
npx prettier --check src/components/agent-setup-view.tsx src/components/agent-setup-view.test.tsx src/app/globals.css
npm run typecheck
```

Expected: all commands exit successfully.

### Task 2: Verify behavior and review documentation

**Files:**

- Review: `README.md`
- Review: `AGENTS.md`
- Review: `CLAUDE.md`
- Review: `docs/superpowers/specs/2026-08-16-agent-inventory-category-disclosures-design.md`

**Interfaces:**

- Consumes: the completed category disclosure behavior from Task 1.
- Produces: verified desktop/mobile behavior and an explicit documentation decision.

- [ ] **Step 1: Run full project verification**

Run:

```bash
npm run verify
```

Expected: formatting, linting, type checking, tests, and production build all pass. If unrelated pre-existing changes fail verification, record the exact failure and run targeted checks for the files changed by this feature.

- [ ] **Step 2: Verify the visible interaction in a browser**

Open `/agents?view=inventory` and verify at desktop and mobile widths:

- every category starts open;
- clicking one category heading hides and restores only its rows;
- other categories remain open;
- nested plugin disclosures still toggle independently;
- category title, description, and count remain visible when collapsed;
- focus styling is visible with keyboard navigation;
- no horizontal overflow or new console errors appear.

- [ ] **Step 3: Review required documentation**

Document the user-facing disclosure behavior in the existing Agent Setup paragraph in `README.md`. Review `AGENTS.md` and `CLAUDE.md`; update them only if the implementation introduces an architecture or convention change.

- [ ] **Step 4: Inspect the final diff**

Run:

```bash
git diff --check
git diff -- src/components/agent-setup-view.tsx src/components/agent-setup-view.test.tsx src/app/globals.css docs/superpowers/specs/2026-08-16-agent-inventory-category-disclosures-design.md docs/superpowers/plans/2026-08-16-agent-inventory-category-disclosures.md
```

Confirm the diff contains only the approved disclosure behavior, its regression coverage, and planning artifacts.
