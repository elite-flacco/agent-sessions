# Agent Setup Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `/agents` page that inventories global agent capabilities and compares discrepancies across Codex, Claude Code, Zcode, and Pi.

**Architecture:** A server-only discovery package reads known global provider files into a client-safe normalized model without persistence. A synchronous server-rendered view consumes URL-backed filters and renders detailed inventory or a four-provider comparison matrix.

**Tech Stack:** Next.js 16 App Router, React 19 Server Components, TypeScript, Node filesystem APIs, Vitest, Tailwind CSS 4 semantic tokens.

## Global Constraints

- Implement only global discovery; preserve an explicit scope seam for future project discovery.
- Never return MCP commands, command arguments, environment variables, credentials, or raw configuration blocks.
- Do not add a database migration or collector integration.
- Use semantic tokens and component classes from `src/app/globals.css`; no raw Tailwind palette colors, arbitrary values, inline styles, or `dark:` variants.
- Preserve unrelated untracked `.zcode/plans/` and `docs/reviews/` content.
- `npm run verify` must exit successfully without weakening a check.
- Update `README.md`, `AGENTS.md`, and `CLAUDE.md` for the completed behavior and architecture.

---

### Task 1: Normalize capability identity, provenance, and comparison

**Files:**

- Create: `src/lib/agent-inventory/types.ts`
- Create: `src/lib/agent-inventory/normalize.ts`
- Test: `src/lib/agent-inventory/normalize.test.ts`

**Interfaces:**

- Produces: `InventoryScope`, `AgentInventory`, `AgentCapability`, `InstructionFile`, `InventoryWarning`, `ComparisonRow`, `canonicalCapabilityName()`, `dedupeCapabilities()`, and `buildComparisonRows()`.
- Consumes: `AgentProvider` from `src/lib/types.ts`.

- [ ] **Step 1: Write failing normalization and comparison tests**

```ts
test("deduplicates a linked skill by canonical source and keeps stronger provenance", () => {
  const result = dedupeCapabilities([
    capability({ origin: "unknown", sourcePath: "/tmp/link" }),
    capability({
      origin: "skills_sh",
      sourcePath: "/tmp/source",
      canonicalSourcePath: "/tmp/source",
    }),
  ]);
  expect(result).toHaveLength(1);
  expect(result[0]?.origin).toBe("skills_sh");
});

test("marks presence and provenance differences as discrepancies", () => {
  const rows = buildComparisonRows(inventories);
  expect(rows.find((row) => row.name === "agent-browser")?.isDiscrepancy).toBe(
    true,
  );
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx vitest run src/lib/agent-inventory/normalize.test.ts`

Expected: FAIL because `types.ts` and `normalize.ts` do not exist.

- [ ] **Step 3: Implement the normalized model and pure comparison helpers**

```ts
export type CapabilityKind = "plugin" | "skill" | "mcp";
export type CapabilityStatus =
  "enabled" | "disabled" | "installed" | "unavailable";
export type CapabilityPackaging = "standalone" | "plugin" | "built_in";
export type CapabilityOrigin =
  "personal" | "skills_sh" | "marketplace" | "built_in" | "unknown";

export function canonicalCapabilityName(value: string): string {
  return value.trim().toLocaleLowerCase();
}
```

Implement deterministic sorting, canonical-source deduplication, provenance priority, and discrepancy comparison across presence, status, packaging, origin, and source repository. Instruction fingerprints participate as a synthetic comparison row.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `npx vitest run src/lib/agent-inventory/normalize.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the normalized model**

```bash
git add src/lib/agent-inventory/types.ts src/lib/agent-inventory/normalize.ts src/lib/agent-inventory/normalize.test.ts
git commit -m "feat: model agent capability inventory"
```

### Task 2: Discover global provider configuration safely

**Files:**

- Create: `src/lib/agent-inventory/shared.ts`
- Create: `src/lib/agent-inventory/codex.ts`
- Create: `src/lib/agent-inventory/claude.ts`
- Create: `src/lib/agent-inventory/zcode.ts`
- Create: `src/lib/agent-inventory/pi.ts`
- Create: `src/lib/agent-inventory/index.ts`
- Test: `src/lib/agent-inventory/discovery.test.ts`

**Interfaces:**

- Produces: `getAgentInventories(scope, options)`, where injected `homeDir`, `personalSkillRoots`, and provider path overrides make fixture tests deterministic.
- Consumes: the Task 1 normalized types and helpers.

- [ ] **Step 1: Write failing fixture tests for all provider readers**

```ts
test("discovers names and status without leaking MCP configuration", async () => {
  await writeFixture(
    ".codex/config.toml",
    `
[plugins."github@openai-curated"]
enabled = false
source = "/tmp/github-plugin"
[mcp_servers.langsmith]
command = "secret-command"
args = ["--token", "secret-token"]
[mcp_servers.langsmith.env]
API_KEY = "secret-value"
`,
  );

  const result = await getAgentInventories({ kind: "global" }, { homeDir });
  const serialized = JSON.stringify(result);
  expect(serialized).toContain("langsmith");
  expect(serialized).not.toContain("secret-command");
  expect(serialized).not.toContain("secret-token");
  expect(serialized).not.toContain("secret-value");
});
```

Add fixtures for Claude and Zcode installed/enabled plugins, Pi skills, skills.sh lock provenance, personal symlink provenance, plugin-provided skills, broken symlinks, instruction content, malformed JSON, and one-source partial failure.

- [ ] **Step 2: Run discovery tests and verify RED**

Run: `npx vitest run src/lib/agent-inventory/discovery.test.ts`

Expected: FAIL because the discovery entry point does not exist.

- [ ] **Step 3: Implement shared safe readers**

```ts
export interface InventoryDiscoveryOptions {
  homeDir?: string;
  personalSkillRoots?: string[];
  paths?: Partial<Record<AgentProvider, ProviderInventoryPaths>>;
}

export async function readJsonObject(
  path: string,
): Promise<Record<string, unknown> | undefined>;
export async function discoverSkillDirectory(
  path: string,
  context: SkillContext,
): Promise<AgentCapability[]>;
export async function readInstruction(
  path: string,
): Promise<InstructionFile | undefined>;
```

Use `realpath` for canonical sources, preserve broken links as unavailable, read only `SKILL.md` frontmatter names, and hash instruction content with SHA-256. Read `~/.agents/.skill-lock.json` once and match entries by skill name and canonical path.

- [ ] **Step 4: Implement provider-specific allowlist readers**

Codex extracts only plugin table names, optional enabled booleans, safe source paths, and top-level MCP table names from TOML. Claude and Zcode extract installed plugin identifiers and install paths from their installed-plugin registries, enabled state from settings/config, and plugin skill directories. Pi reports its global skill directory and only explicitly supported name/status fields when extension or MCP configuration is present.

Every parse/read failure becomes:

```ts
{
  sourcePath,
  code: "unreadable" | "malformed" | "unsupported",
  message: "Could not parse global provider configuration.",
}
```

The message must not include raw content or secret-bearing parser excerpts.

- [ ] **Step 5: Run discovery and normalization tests and verify GREEN**

Run: `npx vitest run src/lib/agent-inventory`

Expected: PASS with no secret values in output.

- [ ] **Step 6: Commit global discovery**

```bash
git add src/lib/agent-inventory
git commit -m "feat: discover global agent capabilities"
```

### Task 3: Render the Agent setup inventory and comparison page

**Files:**

- Create: `src/app/agents/page.tsx`
- Create: `src/components/agent-setup-view.tsx`
- Create: `src/components/agent-setup-view.test.tsx`
- Modify: `src/components/sidebar.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**

- Consumes: `getAgentInventories({ kind: "global" })`, `buildComparisonRows()`, and normalized inventory types.
- Produces: `/agents`, `AgentSetupFilters`, `AgentSetupView`, Inventory and Compare links/forms, provider summaries, safe detail disclosures, and responsive comparison markup.

- [ ] **Step 1: Write failing server-rendered component tests**

```tsx
test("comparison mode shows only discrepant rows when requested", () => {
  const html = renderToStaticMarkup(
    <AgentSetupView
      inventories={fixtureInventories}
      filters={{ view: "compare", discrepanciesOnly: true }}
    />,
  );
  expect(html).toContain("agent-browser");
  expect(html).not.toContain("frontend-rules");
  expect(html).not.toContain("secret-command");
});
```

Add tests for provider counts, empty providers, warnings, inventory metadata, instruction disclosure, view URLs, and comparison cells.

- [ ] **Step 2: Run the component test and verify RED**

Run: `npx vitest run src/components/agent-setup-view.test.tsx`

Expected: FAIL because `AgentSetupView` does not exist.

- [ ] **Step 3: Implement the server page using Next.js 16 request APIs**

```tsx
interface AgentsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AgentsPage({ searchParams }: AgentsPageProps) {
  const params = await searchParams;
  const inventories = await getAgentInventories({ kind: "global" });
  return (
    <main className="relay-shell">
      <Sidebar
        connectedAgents={health.connectedAgents}
        sourceErrors={health.parseErrors}
      />
      <AgentSetupView
        inventories={inventories}
        filters={parseAgentSetupFilters(params)}
      />
    </main>
  );
}
```

Keep `export const dynamic = "force-dynamic"` consistent with other live Relay pages.

- [ ] **Step 4: Implement semantic Inventory and Compare markup**

Use GET forms and links for URL-backed state, native `<details>` for instruction and cell provenance, a semantic table for comparison, and `<pre>` for inert instruction Markdown source. Add an `Agent setup` sidebar link with a `Blocks` icon and `pathname === "/agents"` active state.

- [ ] **Step 5: Add responsive component classes**

Add named `.agent-*` classes under `@layer components` using existing variables only. Reuse `.card`, `.badge`, `.input`, `.select`, and `.workspace-switcher` where their semantics match. At `max-width: 900px`, stack provider summaries; at `max-width: 640px`, keep comparison in a labeled horizontal overflow region rather than dropping provider columns.

- [ ] **Step 6: Run component and inventory tests and verify GREEN**

Run: `npx vitest run src/components/agent-setup-view.test.tsx src/lib/agent-inventory`

Expected: PASS.

- [ ] **Step 7: Commit the page**

```bash
git add src/app/agents/page.tsx src/components/agent-setup-view.tsx src/components/agent-setup-view.test.tsx src/components/sidebar.tsx src/app/globals.css
git commit -m "feat: add agent setup comparison page"
```

### Task 4: Document, verify, and browser-test the completed feature

**Files:**

- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify if implementation details changed: `docs/superpowers/specs/2026-07-14-agent-setup-inventory-design.md`

**Interfaces:**

- Consumes: the completed discovery boundary and `/agents` behavior.
- Produces: current user and maintainer documentation plus fresh verification evidence.

- [ ] **Step 1: Review actual behavior against the spec**

Check every source, normalized field, filter, privacy exclusion, empty/warning state, and comparison rule. Update the spec only if the final implementation made an intentional, approved clarification.

- [ ] **Step 2: Update user and architecture documentation**

Add `/agents` to the README route table, document global-only live discovery and safe-field privacy exclusions, and list provider source locations. Add the server-only inventory boundary, provenance model, comparison identity, and future project-scope seam to `AGENTS.md`; `CLAUDE.md` inherits those instructions via `@AGENTS.md`, so retain that delegation unless an independent note is required.

- [ ] **Step 3: Run formatting and inspect the diff**

Run: `npm run format`

Run: `git diff --check && git diff --stat && git status --short`

Expected: no whitespace errors and no unrelated `.zcode/plans/` or `docs/reviews/` files staged.

- [ ] **Step 4: Run the complete project verification gate**

Run: `npm run verify`

Expected: lint, typecheck, format check, all tests, and production build exit successfully.

- [ ] **Step 5: Verify the live UI in a browser**

Run `npm run dev`, open `/agents`, and verify Inventory and Compare at desktop and mobile widths. Exercise search, provider/type/status filters, discrepancies-only state, instruction and provenance disclosures, empty/warning states, keyboard focus, comparison overflow, and browser console errors.

- [ ] **Step 6: Commit documentation and final verification adjustments**

```bash
git add README.md AGENTS.md CLAUDE.md docs/superpowers/specs/2026-07-14-agent-setup-inventory-design.md
git commit -m "docs: document agent setup inventory"
```

Do not stage the design spec if it did not change after its earlier commit.
