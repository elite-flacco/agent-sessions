# Project Card GitHub Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a safe, optional GitHub link on each Projects landing card when its observed local workdirs agree on one GitHub origin.

**Architecture:** A focused server-side helper finds Git roots, reads `remote.origin.url` with argument-safe Git execution, normalizes allowlisted GitHub URL forms, and returns one URL only when every observed workdir agrees. `ProjectSummary` carries that ephemeral URL to the Projects component, which renders sibling internal and external links to avoid nested anchors.

**Tech Stack:** TypeScript, Node.js filesystem/child-process APIs, Next.js 16 App Router, React 19, Vitest, Testing Library, Tailwind CSS v4 semantic tokens.

## Global Constraints

- Derive links at read time; do not persist remotes or add a schema migration.
- Accept only credential-free `github.com` HTTPS and SSH origin forms.
- Return no link for missing, malformed, non-GitHub, or conflicting evidence.
- Preserve unrelated working-tree changes and do not commit until the user explicitly authorizes it.
- Follow `docs/superpowers/plan-dod.md`, including `npm run verify`, browser QA, and final documentation review.

---

### Task 1: Safe GitHub origin resolver

**Files:**

- Create: `src/lib/project-github.ts`
- Create: `src/lib/project-github.test.ts`

**Interfaces:**

- Produces: `findGitRoot(cwd: string): string | null`
- Produces: `normalizeGitHubRemote(remote: string): string | null`
- Produces: `resolveProjectGitHubUrl(workdirs: string[], dependencies?): string | null`

- [x] Write table-driven failing tests for HTTPS, SCP-style SSH, URL-style SSH, credentials, malformed paths, non-GitHub hosts, missing origins, duplicate roots, and conflicting origins.
- [x] Run `npm run test:run -- src/lib/project-github.test.ts` and confirm failure because the module does not exist.
- [x] Implement the minimal pure normalization and conservative resolver, with a production origin reader using `execFileSync("git", ["-C", root, "config", "--get", "remote.origin.url"])` and a short timeout.
- [x] Re-run the focused test and confirm it passes.

### Task 2: Project summary integration

**Files:**

- Modify: `src/lib/queries.ts`
- Modify: `src/lib/queries.test.ts`

**Interfaces:**

- Consumes: `findGitRoot` and `resolveProjectGitHubUrl` from Task 1.
- Produces: required `ProjectSummary.githubUrl: string | null`.

- [x] Add a failing query assertion that a project summary always exposes the nullable `githubUrl` contract.
- [x] Run the focused query test and confirm the missing property failure.
- [x] Replace the local Git-root helper with the shared helper and populate `githubUrl` in every project/task summary path.
- [x] Run `npm run test:run -- src/lib/queries.test.ts` and confirm it passes.

### Task 3: Projects card link

**Files:**

- Modify: `src/components/projects-view.tsx`
- Modify: `src/components/projects-view.test.tsx`
- Modify only if needed: `src/app/globals.css`
- Modify fixture: `src/components/overview-view.test.tsx`

**Interfaces:**

- Consumes: `ProjectSummary.githubUrl`.
- Preserves: internal `/projects?project=<key>` navigation.

- [x] Add failing component tests for an accessible external GitHub link with `target="_blank"` and `rel="noreferrer"`, no external link when null, and the unchanged Relay briefing link.
- [x] Run `npm run test:run -- src/components/projects-view.test.tsx` and confirm the external-link assertion fails.
- [x] Restructure each card as a non-anchor container with sibling Relay and GitHub links; use `Github`/`ExternalLink` icons and existing semantic classes/utilities.
- [x] Update typed fixtures and run the focused component tests.
- [x] Confirm no nested anchors and no raw palette, arbitrary-value, inline-style, or dark-variant additions.

### Task 4: Documentation and complete verification

**Files:**

- Review and modify if useful: `README.md`
- Review only unless conventions changed: `AGENTS.md`, `CLAUDE.md`

- [x] Document that Projects can show detected GitHub origins; do not add architecture text unless conventions changed.
- [x] Run formatting on changed files, then `npm run verify`; fix change-caused failures and report exact unrelated failures.
- [x] Run Relay locally and browser-check `/projects` at desktop and 390px mobile widths, with and without a detected GitHub origin; exercise both links and inspect the console.
- [x] Review the final diff against the design, `docs/superpowers/plan-dod.md`, `README.md`, `AGENTS.md`, and `CLAUDE.md`.
