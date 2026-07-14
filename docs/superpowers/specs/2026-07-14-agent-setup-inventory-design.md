# Agent Setup Inventory Design

## Goal

Add a read-only Relay page that inventories the globally installed plugins,
skills, MCP servers, and instruction file for Codex, Claude Code, Zcode, and
Pi. The page must make cross-agent discrepancies easy to spot while preserving
a clean extension point for future project-level discovery.

## Scope

This release discovers only user-level configuration under each provider's
global home directories. It does not discover repository-level configuration,
persist inventory data, modify agent configuration, or expose install, enable,
disable, edit, or delete controls.

The inventory is read live on each `/agents` request. It remains separate from
the session collector and Relay's SQLite database.

## Route and navigation

Add `/agents` as a primary sidebar destination labeled **Agent setup**. The
route is a dynamic server page that reads the current global inventory and
passes a normalized, serializable model to a client view.

The page has two URL-backed modes:

- **Inventory** presents provider summaries and detailed capability metadata.
- **Compare** presents a capability-by-provider matrix with an optional
  **Discrepancies only** filter.

Search, capability type, provider, status, and comparison mode are URL-backed
so a useful view can be bookmarked or shared locally.

## Discovery architecture

Create a server-only inventory boundary with one reader per provider and a
shared normalization layer. The public entry point accepts an explicit scope:

```ts
type InventoryScope = { kind: "global" };

function getAgentInventories(
  scope: InventoryScope,
  options?: InventoryDiscoveryOptions,
): Promise<AgentInventory[]>;
```

Only `{ kind: "global" }` is implemented. A future
`{ kind: "project"; cwd: string }` variant can reuse the normalized model and
UI without changing the current discovery contract.

Provider readers inspect only known configuration files and installation
directories:

- Codex: `~/.codex/config.toml`, `~/.codex/skills`, configured plugin roots,
  and `~/.codex/AGENTS.md`.
- Claude Code: `~/.claude/settings.json`,
  `~/.claude/plugins/installed_plugins.json`, `~/.claude/skills`, global MCP
  configuration when present, and `~/.claude/CLAUDE.md`.
- Zcode: `~/.zcode/cli/config.json`,
  `~/.zcode/cli/plugins/installed_plugins.json`, `~/.zcode/skills`, plugin
  manifests, and `~/.zcode/AGENTS.md`.
- Pi: `~/.pi/agent/settings.json`, `~/.pi/agent/skills`, supported extension or
  MCP configuration when present, and a global instruction file when present.

Missing provider surfaces are normal empty states. A malformed or unreadable
source produces a warning scoped to that provider and source while discovery
continues for all remaining sources.

## Normalized model

```ts
interface AgentInventory {
  provider: AgentProvider;
  scope: "global";
  capabilities: AgentCapability[];
  instructionFile?: InstructionFile;
  warnings: InventoryWarning[];
}

interface AgentCapability {
  id: string;
  name: string;
  kind: "plugin" | "skill" | "mcp";
  status: "enabled" | "disabled" | "installed" | "unavailable";
  packaging: "standalone" | "plugin" | "built_in";
  origin: "personal" | "skills_sh" | "marketplace" | "built_in" | "unknown";
  sourcePlugin?: string;
  sourceRepository?: string;
  sourcePath?: string;
}

interface InstructionFile {
  filename: string;
  sourcePath: string;
  content: string;
  contentFingerprint: string;
}
```

Capability identity uses provider, kind, canonical name, and canonical source.
Comparison identity uses kind and canonical name so equivalent capabilities
align across providers. Canonical names are trimmed and case-folded for
comparison without changing display names.

## Skill provenance and deduplication

Packaging and origin are independent dimensions.

- A skill listed in `~/.agents/.skill-lock.json` is a standalone skills.sh
  installation. Its lock entry supplies source repository and URL provenance.
- A skill found beneath an installed provider plugin is plugin-packaged and
  carries the owning plugin name.
- A skill whose resolved symlink target is inside the user's local
  `agent-skills` repository is personal and standalone.
- A skill beneath an agent-owned system directory is built in.
- A filesystem skill without trustworthy provenance is unknown rather than
  guessed.

Plugin-provided and standalone skills are both included. Entries resolving to
the same canonical source path are deduplicated, preferring the record with
stronger provenance. Broken symlinks remain visible with `unavailable` status.

## Privacy boundary

The inventory boundary is allowlist-based. It may return capability names,
types, status, packaging, origin, source plugin, source repository, safe source
paths, provider warnings, and global instruction Markdown.

It must never return or render MCP commands, command arguments, environment
variables, credentials, raw configuration blocks, or arbitrary plugin manifest
payloads. Parsing extracts only MCP table or object keys and explicit enabled
flags. Error messages identify the source and failure class without embedding
raw file content.

## Inventory view

The default view shows one provider summary per supported agent with counts by
capability type, instruction-file presence, and warning count. Selecting a
provider filters the detailed capability list.

Each capability row shows:

- name and type;
- enabled, disabled, installed, or unavailable status;
- standalone, plugin, or built-in packaging;
- personal/local, skills.sh, built-in, plugin marketplace, or unknown origin;
- source repository when known; and
- an abbreviated safe source path.

Instruction files appear in collapsible panels with filename, full path, and
full Markdown source. Relay renders the source as text and does not execute
embedded HTML.

## Compare view

The comparison matrix contains the union of capabilities across Codex, Claude
Code, Zcode, and Pi. Each provider cell shows presence and status. Selecting a
cell reveals safe provenance and path details.

**Discrepancies only** retains rows where providers differ by presence, status,
packaging, origin, or source repository. The instruction row also counts as a
discrepancy when a file is missing or content fingerprints differ. Selecting an
instruction cell opens that provider's full Markdown source.

At narrow widths the matrix remains a semantic table inside a horizontally
scrollable comparison region; provider labels and capability names remain
visible and keyboard navigation uses native controls.

## Error and empty states

- An agent with no discovered configuration remains visible with zero counts.
- A missing instruction file reads **Not found**.
- Broken skill links remain visible as **Unavailable**.
- Provider warnings are summarized on the provider card and expanded in the
  detailed area.
- One failed source never prevents other sources or providers from rendering.

## Testing and verification

Unit tests use temporary home-directory fixtures and injected discovery paths.
They cover provider config parsing, installed-versus-enabled plugin status,
skills.sh provenance, personal symlink provenance, plugin skill discovery,
canonical-path deduplication, broken symlinks, MCP name-only extraction,
instruction loading, malformed sources, and partial provider failure.

Privacy tests assert that MCP commands, arguments, environment values,
credentials, and raw config blocks do not appear anywhere in the normalized
result. Component tests cover the inventory and comparison modes, shared
filters, discrepancy detection, instruction expansion, warnings, and empty
states.

Completion requires `npm run verify` plus browser verification of `/agents` at
desktop and mobile widths, including filters, both modes, empty and warning
states, keyboard focus, horizontal comparison scrolling, and a clean browser
console.

## Documentation

Update `README.md` with the new route, supported global sources, read-only
privacy boundary, and global-only limitation. Update `AGENTS.md` and
`CLAUDE.md` with the inventory boundary, live-read behavior, normalized
provenance model, and the future project-scope seam.
