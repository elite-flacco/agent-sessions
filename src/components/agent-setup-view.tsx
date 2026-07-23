import {
  AlertTriangle,
  Check,
  CircleSlash2,
  CircleX,
  FileText,
  Minus,
  Plug,
  Search,
  WandSparkles,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { AgentFilterForm } from "@/components/agent-filter-form";
import {
  buildComparisonRows,
  findComparisonDuplicates,
  type AgentCapability,
  type AgentInventory,
  type CapabilityKind,
  type CapabilityStatus,
  type ComparisonAssessmentReason,
  type ComparisonDuplicate,
  type ComparisonRow,
  type InventoryWarning,
  type ScheduledTask,
} from "@/lib/agent-inventory";
import { compareScheduledTasks } from "@/lib/agent-inventory/schedule";
import { providerBadges, providerLabels } from "@/lib/labels";
import { shortenHomePath } from "@/lib/format";
import { agentProviders, type AgentProvider } from "@/lib/types";

export type AgentSetupViewMode = "inventory" | "compare" | "tasks";
type AgentSetupKind = CapabilityKind | "instruction";

export interface AgentSetupFilters {
  view: AgentSetupViewMode;
  comparisonMode?: "attention";
  q?: string;
  provider?: AgentProvider;
  kind?: AgentSetupKind;
  status?: CapabilityStatus;
  discrepanciesOnly?: boolean;
}

interface AgentSetupViewProps {
  inventories: AgentInventory[];
  filters: AgentSetupFilters;
}

const kindLabels: Record<AgentSetupKind, string> = {
  plugin: "Plugins",
  skill: "Skills",
  mcp: "MCPs",
  instruction: "Instructions",
};

const kindSortOrder: Record<CapabilityKind, number> = {
  plugin: 0,
  skill: 1,
  mcp: 2,
};

const comparisonKindSortOrder: Record<ComparisonRow["kind"], number> = {
  plugin: 0,
  skill: 1,
  mcp: 2,
  instruction: 3,
};

const assessmentOrder = { fix: 0, review: 1, context: 2 } as const;

const capabilityKindLabels: Record<AgentSetupKind, string> = {
  plugin: "Plugin",
  skill: "Skill",
  mcp: "MCP",
  instruction: "Instruction",
};

const kindMarkers: Record<AgentSetupKind, string> = {
  plugin: "agent-kind-plugin",
  skill: "agent-kind-skill",
  mcp: "agent-kind-mcp",
  instruction: "agent-kind-instruction",
};

const kindIcons: Record<AgentSetupKind, LucideIcon> = {
  plugin: Plug,
  skill: WandSparkles,
  mcp: Waypoints,
  instruction: FileText,
};

const statusLabels: Record<CapabilityStatus, string> = {
  enabled: "Enabled",
  disabled: "Disabled",
  installed: "Installed",
  unavailable: "Unavailable",
};

const statusBadges: Record<CapabilityStatus, string> = {
  enabled: "badge-1",
  installed: "badge-1",
  disabled: "badge-4",
  unavailable: "badge-4",
};

const originLabels: Record<AgentCapability["origin"], string> = {
  personal: "Personal",
  skills_sh: "skills.sh",
  marketplace: "Marketplace",
  built_in: "Built in",
  unknown: "Unknown",
};

/**
 * Inventory ordering for origins. Mostly alphabetical by label, except
 * skills.sh sorts above Personal so managed installs read before local links.
 */
/**
 * Review sections in the Needs Attention view, most actionable first. Each
 * reason has a different remedy — reinstall from one source, reconcile config,
 * install the missing copy — so they must not read as one list. Reasons absent
 * here (the Fix-level ones, plus `provider_specific`/`consistent`) never reach
 * a review section.
 */
const reviewSections: readonly {
  reason: ComparisonAssessmentReason;
  label: string;
}[] = [
  { reason: "content_drift", label: "Reviews · Different content" },
  {
    reason: "configuration_drift",
    label: "Reviews · Different configuration",
  },
  { reason: "instruction_drift", label: "Reviews · Instruction drift" },
  {
    reason: "missing_from_one_provider",
    label: "Reviews · Missing from one agent",
  },
];

const originSortOrder: Record<AgentCapability["origin"], number> = {
  built_in: 0,
  marketplace: 1,
  skills_sh: 2,
  personal: 3,
  unknown: 4,
};

const originBadges: Record<AgentCapability["origin"], string> = {
  personal: "badge-1",
  skills_sh: "badge-2",
  marketplace: "badge-3",
  built_in: "badge-4",
  unknown: "badge-5",
};

function countLabel(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseAgentSetupFilters(
  params: Record<string, string | string[] | undefined>,
): AgentSetupFilters {
  const provider = first(params.provider);
  const kind = first(params.kind);
  const status = first(params.status);
  return {
    view:
      first(params.view) === "compare"
        ? "compare"
        : first(params.view) === "tasks"
          ? "tasks"
          : "inventory",
    comparisonMode:
      first(params.comparison) === "attention" ? "attention" : undefined,
    q: first(params.q)?.trim() || undefined,
    provider: agentProviders.includes(provider as AgentProvider)
      ? (provider as AgentProvider)
      : undefined,
    kind: ["plugin", "skill", "mcp", "instruction"].includes(kind ?? "")
      ? (kind as AgentSetupKind)
      : undefined,
    status: ["enabled", "installed", "disabled", "unavailable"].includes(
      status ?? "",
    )
      ? (status as CapabilityStatus)
      : undefined,
    discrepanciesOnly: first(params.discrepancies) === "1" || undefined,
  };
}

function setupHref(
  filters: AgentSetupFilters,
  changes: Partial<AgentSetupFilters>,
): string {
  const next = { ...filters, ...changes };
  const params = new URLSearchParams();
  if (next.view === "compare") params.set("view", "compare");
  else if (next.view === "tasks") params.set("view", "tasks");
  if (next.comparisonMode === "attention") {
    params.set("comparison", "attention");
  }
  if (next.q) params.set("q", next.q);
  if (next.provider) params.set("provider", next.provider);
  if (next.kind) params.set("kind", next.kind);
  if (next.status) params.set("status", next.status);
  if (next.discrepanciesOnly) params.set("discrepancies", "1");
  const query = params.toString();
  return query ? `/agents?${query}` : "/agents";
}

function matchesCapability(
  capability: AgentCapability,
  filters: AgentSetupFilters,
  ignoreKind = false,
): boolean {
  // Disabled capabilities are retained in the discovery data so the Compare
  // view can tell deliberate disables from missing installs, but the
  // Inventory list shows only what is in effect.
  if (capability.status === "disabled") return false;
  // The Inventory view selects kind with the rail, so it filters the kind
  // itself and asks this helper to ignore filters.kind.
  if (!ignoreKind && filters.kind && filters.kind !== capability.kind) {
    return false;
  }
  if (filters.status && filters.status !== capability.status) return false;
  if (!filters.q) return true;
  const query = filters.q.toLocaleLowerCase();
  return [
    capability.name,
    capability.sourcePlugin,
    capability.sourceRepository,
    capability.sourcePath,
  ].some((value) => value?.toLocaleLowerCase().includes(query));
}

/**
 * The always-visible "source" line for a comparison cell: the contributing
 * plugin name for plugin-packaged capabilities, otherwise the skills.sh
 * repository for skills.sh-installed standalone skills. Personal, built_in, and
 * unknown-origin capabilities have no useful source identifier and render no
 * line; their origin is still shown inside the expanded details body.
 */
function capabilitySourceLabel(
  capability: AgentCapability,
): string | undefined {
  if (capability.sourcePlugin) return capability.sourcePlugin;
  if (capability.origin === "skills_sh" && capability.sourceRepository) {
    return capability.sourceRepository;
  }
  return undefined;
}

function compareInventoryCapabilities(
  left: AgentCapability,
  right: AgentCapability,
): number {
  // Skills that share a group key (same plugin or same skills.sh repo) must
  // land in a contiguous run so buildInventoryItems can collapse them.
  // Inserting the group key between origin and name keeps the existing
  // kind/origin/name ordering for everything else; non-groupable
  // capabilities return undefined and fall through to the name phase.
  const leftGroup = skillGroupKey(left) ?? "";
  const rightGroup = skillGroupKey(right) ?? "";
  return (
    kindSortOrder[left.kind] - kindSortOrder[right.kind] ||
    originSortOrder[left.origin] - originSortOrder[right.origin] ||
    leftGroup.localeCompare(rightGroup) ||
    left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id)
  );
}

/**
 * Comparator for render items: collapsed groups sort before flat rows within
 * the same kind/origin bucket (derived from the group's first member or the
 * flat row's capability), then by name. This puts the collapsed <details>
 * summaries at the top of each provider section and pushes flat singletons
 * (personal/built_in/unknown skills, lone skills.sh installs, single-skill
 * plugins) below them, while keeping relative order stable within each tier.
 */
function compareInventoryItems(
  left: InventoryItem,
  right: InventoryItem,
): number {
  const leftCapability =
    left.kind === "group" ? left.members[0]! : left.capability;
  const rightCapability =
    right.kind === "group" ? right.members[0]! : right.capability;
  const leftRank = left.kind === "group" ? 0 : 1;
  const rightRank = right.kind === "group" ? 0 : 1;
  return (
    kindSortOrder[leftCapability.kind] - kindSortOrder[rightCapability.kind] ||
    originSortOrder[leftCapability.origin] -
      originSortOrder[rightCapability.origin] ||
    leftRank - rightRank ||
    leftCapability.name.localeCompare(rightCapability.name) ||
    leftCapability.id.localeCompare(rightCapability.id)
  );
}

/**
 * The optional group key for a capability in the inventory view. Skills
 * cluster under their contributing plugin (marketplace + sourcePlugin) or
 * skills.sh repository (skills_sh + sourceRepository); everything else —
 * plugins, MCPs, and personal/built_in/unknown-origin skills — returns
 * undefined and renders flat.
 */
function skillGroupKey(capability: AgentCapability): string | undefined {
  if (capability.kind !== "skill") return undefined;
  if (capability.origin === "marketplace" && capability.sourcePlugin) {
    return `plugin:${capability.sourcePlugin}`;
  }
  if (capability.origin === "skills_sh" && capability.sourceRepository) {
    return `skillssh:${capability.sourceRepository}`;
  }
  return undefined;
}

interface SkillGroupSummary {
  key: string;
  kind: "plugin" | "skills_sh";
  name: string;
  memberCount: number;
}

/**
 * Build the summary that `CapabilityGroup` renders in its <summary>. Members
 * must share a group key (caller's responsibility). Name and kind are derived
 * from the first member.
 */
function summarizeSkillGroup(members: AgentCapability[]): SkillGroupSummary {
  const first = members[0]!;
  const key = skillGroupKey(first)!;
  if (first.origin === "marketplace" && first.sourcePlugin) {
    return {
      key,
      kind: "plugin",
      name: first.sourcePlugin,
      memberCount: members.length,
    };
  }
  return {
    key,
    kind: "skills_sh",
    name: first.sourceRepository!,
    memberCount: members.length,
  };
}

type InventoryItem =
  | { kind: "row"; capability: AgentCapability }
  | { kind: "group"; summary: SkillGroupSummary; members: AgentCapability[] };

/**
 * Partition capabilities by origin, ordered via originSortOrder so the source
 * groups read in the same order used elsewhere in the view.
 */
function partitionByOrigin(
  capabilities: AgentCapability[],
): { origin: AgentCapability["origin"]; capabilities: AgentCapability[] }[] {
  const byOrigin = new Map<AgentCapability["origin"], AgentCapability[]>();
  for (const capability of capabilities) {
    const list = byOrigin.get(capability.origin) ?? [];
    list.push(capability);
    byOrigin.set(capability.origin, list);
  }
  return [...byOrigin.entries()]
    .sort(([left], [right]) => originSortOrder[left] - originSortOrder[right])
    .map(([origin, members]) => ({ origin, capabilities: members }));
}

/**
 * Walk the sorted capability list and emit render items, collapsing runs of
 * two or more consecutive same-key skills into a single group item. Runs of
 * fewer than two (including all non-skill capabilities) emit one row item
 * each so single-skill plugins and personal/built_in/unknown skills render
 * flat.
 */
function buildInventoryItems(capabilities: AgentCapability[]): InventoryItem[] {
  const items: InventoryItem[] = [];
  let currentKey: string | undefined;
  let pending: AgentCapability[] = [];
  const flush = () => {
    if (pending.length === 0) return;
    if (currentKey === undefined || pending.length < 2) {
      for (const capability of pending) {
        items.push({ kind: "row", capability });
      }
    } else {
      items.push({
        kind: "group",
        summary: summarizeSkillGroup(pending),
        members: pending,
      });
    }
    pending = [];
  };
  for (const capability of capabilities) {
    const key = skillGroupKey(capability);
    if (key === currentKey) {
      pending.push(capability);
    } else {
      flush();
      pending = [capability];
      currentKey = key;
    }
  }
  flush();
  return items;
}

export function AgentSetupView({ inventories, filters }: AgentSetupViewProps) {
  // Inventory shows one provider at a time and defaults to the first when none
  // is chosen, so the summary cards act as a single-select provider control.
  const effectiveProvider =
    filters.provider ??
    (filters.view === "inventory" ? inventories[0]?.provider : undefined);
  return (
    <section className="relay-content agent-setup-page">
      <header className="page-header">
        <div>
          <h1>Agent setup</h1>
          <p>
            Live global inventory for installed plugins, skills, MCPs, and
            instruction files. Configuration details and secrets stay hidden.
          </p>
        </div>
      </header>

      <div className="agent-summary-grid" aria-label="Agent setup summaries">
        {inventories.map((inventory) => (
          <ProviderSummary
            key={inventory.provider}
            inventory={inventory}
            active={effectiveProvider === inventory.provider}
            href={setupHref(filters, { provider: inventory.provider })}
          />
        ))}
      </div>

      <nav className="workspace-switcher" aria-label="Agent setup view">
        <Link
          href={setupHref(filters, {
            view: "inventory",
            comparisonMode: undefined,
            discrepanciesOnly: undefined,
          })}
          className={
            filters.view === "inventory"
              ? "workspace-tab tab-active"
              : "workspace-tab"
          }
          aria-current={filters.view === "inventory" ? "page" : undefined}
        >
          Inventory
        </Link>
        <Link
          href={setupHref(filters, {
            view: "compare",
            comparisonMode: "attention",
            discrepanciesOnly: undefined,
          })}
          className={
            filters.view === "compare"
              ? "workspace-tab tab-active"
              : "workspace-tab"
          }
          aria-current={filters.view === "compare" ? "page" : undefined}
        >
          Compare
        </Link>
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
      </nav>

      <FilterForm filters={filters} />

      {filters.view === "compare" ? (
        <ComparisonView inventories={inventories} filters={filters} />
      ) : filters.view === "tasks" ? (
        <ScheduledTasksView inventories={inventories} />
      ) : (
        <InventoryView inventories={inventories} filters={filters} />
      )}
    </section>
  );
}

function ProviderSummary({
  inventory,
  active,
  href,
}: {
  inventory: AgentInventory;
  active: boolean;
  href: string;
}) {
  // Summary counts describe what is in effect; deliberately disabled
  // capabilities only appear in the Compare view.
  const activeCapabilities = inventory.capabilities.filter(
    (capability) => capability.status !== "disabled",
  );
  const counts = Object.fromEntries(
    (["plugin", "skill", "mcp"] as const).map((kind) => [
      kind,
      activeCapabilities.filter((capability) => capability.kind === kind)
        .length,
    ]),
  );
  return (
    <Link
      href={href}
      className={
        active
          ? "card agent-summary agent-summary-active"
          : "card agent-summary"
      }
      aria-current={active ? "true" : undefined}
    >
      <div className="agent-summary-heading">
        <span className={`badge ${providerBadges[inventory.provider]}`}>
          {providerLabels[inventory.provider]}
        </span>
        {inventory.warnings.length > 0 ? (
          <span className="agent-warning-count">
            <AlertTriangle size={13} /> {inventory.warnings.length}
          </span>
        ) : null}
      </div>
      <strong>{activeCapabilities.length} capabilities</strong>
      <span>
        {countLabel(counts.plugin ?? 0, "plugin")} ·{" "}
        {countLabel(counts.skill ?? 0, "skill")} ·{" "}
        {countLabel(counts.mcp ?? 0, "MCP")}
      </span>
      <span>
        {inventory.instructionFile
          ? inventory.instructionFile.filename
          : "Instructions not found"}
      </span>
    </Link>
  );
}

function FilterForm({ filters }: { filters: AgentSetupFilters }) {
  if (filters.view === "tasks") {
    // Tasks have no kind/status/provider filter dimensions; only preserve the
    // view param so form submission (e.g. a search) doesn't revert to inventory.
    return (
      <AgentFilterForm>
        <input type="hidden" name="view" value="tasks" />
        <label className="search-control">
          <span className="sr-only">Search scheduled tasks</span>
          <Search size={14} />
          <input
            className="input"
            type="search"
            name="q"
            defaultValue={filters.q}
            placeholder="Search scheduled tasks"
          />
        </label>
      </AgentFilterForm>
    );
  }
  return (
    <AgentFilterForm>
      {filters.view === "compare" ? (
        <input type="hidden" name="view" value="compare" />
      ) : null}
      {filters.comparisonMode === "attention" ? (
        <input type="hidden" name="comparison" value="attention" />
      ) : null}
      <label className="search-control">
        <span className="sr-only">Search capabilities</span>
        <Search size={14} />
        <input
          className="input"
          type="search"
          name="q"
          defaultValue={filters.q}
          placeholder="Search capabilities"
        />
      </label>
      {filters.view === "compare" ? (
        <>
          <label className="agent-filter">
            <span>Agent</span>
            <select
              className="select"
              name="provider"
              defaultValue={filters.provider ?? ""}
            >
              <option value="">All agents</option>
              {agentProviders.map((provider) => (
                <option key={provider} value={provider}>
                  {providerLabels[provider]}
                </option>
              ))}
            </select>
          </label>
          <label className="agent-filter">
            <span>Type</span>
            <select
              className="select"
              name="kind"
              defaultValue={filters.kind ?? ""}
            >
              <option value="">All types</option>
              {Object.entries(kindLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <>
          {/* Inventory selects provider (cards) and kind (rail); preserve both
              so a Status change or search keeps the current view. */}
          {filters.provider ? (
            <input type="hidden" name="provider" value={filters.provider} />
          ) : null}
          {filters.kind ? (
            <input type="hidden" name="kind" value={filters.kind} />
          ) : null}
        </>
      )}
      <label className="agent-filter">
        <span>Status</span>
        <select
          className="select"
          name="status"
          defaultValue={filters.status ?? ""}
        >
          <option value="">All statuses</option>
          {Object.entries(statusLabels)
            .filter(
              ([value]) => value !== "disabled" || filters.view === "compare",
            )
            .map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
        </select>
      </label>
      {filters.view === "compare" && !filters.comparisonMode ? (
        <label className="agent-discrepancy-toggle">
          <input
            type="checkbox"
            name="discrepancies"
            value="1"
            defaultChecked={filters.discrepanciesOnly}
          />
          <span>Discrepancies only</span>
        </label>
      ) : null}
    </AgentFilterForm>
  );
}

// The Inventory view shows one provider at a time; kind is chosen from a
// vertical rail rather than stacked buckets. Instructions ride along as a
// fourth rail entry when the provider ships an instruction file.
const RAIL_KINDS: Exclude<AgentSetupKind, "instruction">[] = [
  "skill",
  "plugin",
  "mcp",
];

function InventoryView({
  inventories,
  filters,
}: {
  inventories: AgentInventory[];
  filters: AgentSetupFilters;
}) {
  const inventory =
    inventories.find((entry) => entry.provider === filters.provider) ??
    inventories[0];

  if (!inventory) {
    return (
      <div className="card empty-state agent-empty-state">
        <h3>No agents found.</h3>
      </div>
    );
  }

  // Status + search filtered, but NOT kind — the rail owns kind selection.
  const matched = inventory.capabilities
    .filter((capability) => matchesCapability(capability, filters, true))
    .sort(compareInventoryCapabilities);

  const kindCounts = Object.fromEntries(
    RAIL_KINDS.map((kind) => [
      kind,
      matched.filter((capability) => capability.kind === kind).length,
    ]),
  ) as Record<(typeof RAIL_KINDS)[number], number>;
  const instructionVisible = showsInstruction(inventory, filters);

  if (matched.length === 0 && !instructionVisible) {
    return (
      <div className="card empty-state agent-empty-state">
        <h3>No capabilities match these filters.</h3>
        <p>Adjust the search or status selection.</p>
      </div>
    );
  }

  // Default to the first populated kind so the rail never opens on an empty
  // pane; honour an explicit rail selection (including "instruction").
  const requested = filters.kind;
  const selectedKind: AgentSetupKind =
    requested === "instruction" && instructionVisible
      ? "instruction"
      : requested && requested !== "instruction" && kindCounts[requested]
        ? requested
        : (RAIL_KINDS.find((kind) => kindCounts[kind] > 0) ??
          (instructionVisible ? "instruction" : "skill"));

  const selected =
    selectedKind === "instruction"
      ? []
      : matched.filter((capability) => capability.kind === selectedKind);

  // Duplicate-name disambiguation is scoped to the rendered pane, not the
  // whole inventory: a name shared across kinds (e.g. the "github" plugin and
  // the "github" MCP) is unique within each kind's pane, so only same-pane
  // collisions get the path hint.
  const duplicateNames = new Set<string>();
  const nameCounts = new Map<string, number>();
  for (const capability of selected) {
    nameCounts.set(capability.name, (nameCounts.get(capability.name) ?? 0) + 1);
  }
  for (const [name, count] of nameCounts) {
    if (count > 1) duplicateNames.add(name);
  }

  return (
    <div className="agent-inventory-single">
      <header className="agent-provider-heading">
        <div>
          <span className={`badge ${providerBadges[inventory.provider]}`}>
            {providerLabels[inventory.provider]}
          </span>
          <strong>{matched.length} shown</strong>
        </div>
        <span>Global configuration</span>
      </header>
      {inventory.warnings.length > 0 ? (
        <div className="agent-warning-list">
          {inventory.warnings.map((warning) => (
            <div
              key={`${warning.sourcePath}:${warning.code}`}
              className="notice"
            >
              <AlertTriangle size={14} />
              <span>{warning.message}</span>
              <code>{warning.sourcePath}</code>
            </div>
          ))}
        </div>
      ) : null}
      <div className="agent-kind-rail-layout">
        <nav className="agent-kind-rail" aria-label="Capability kind">
          {RAIL_KINDS.map((kind) => (
            <KindRailItem
              key={kind}
              kind={kind}
              count={kindCounts[kind]}
              active={selectedKind === kind}
              href={setupHref(filters, { kind })}
            />
          ))}
          {instructionVisible ? (
            <KindRailItem
              kind="instruction"
              count={1}
              active={selectedKind === "instruction"}
              href={setupHref(filters, { kind: "instruction" })}
            />
          ) : null}
        </nav>
        <div className="agent-kind-rail-content">
          {selectedKind === "instruction" && inventory.instructionFile ? (
            <details className="agent-instruction" open>
              <summary>
                <strong className="agent-instruction-title">
                  {inventory.instructionFile.filename}
                </strong>
                <span>{inventory.instructionFile.sourcePath}</span>
              </summary>
              <pre>{inventory.instructionFile.content}</pre>
            </details>
          ) : selected.length > 0 ? (
            <div className="agent-capability-list">
              {partitionByOrigin(selected).map((group) => (
                <SourceGroup
                  key={group.origin}
                  origin={group.origin}
                  capabilities={group.capabilities}
                  duplicateNames={duplicateNames}
                />
              ))}
            </div>
          ) : (
            <p className="agent-kind-empty">
              No {kindLabels[selectedKind].toLowerCase()} for this agent.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function KindRailItem({
  kind,
  count,
  active,
  href,
}: {
  kind: AgentSetupKind;
  count: number;
  active: boolean;
  href: string;
}) {
  const KindIcon = kindIcons[kind];
  return (
    <Link
      href={href}
      className={
        active ? "agent-kind-rail-item is-active" : "agent-kind-rail-item"
      }
      aria-current={active ? "true" : undefined}
    >
      <KindIcon aria-hidden="true" size={15} />
      <span>{kindLabels[kind]}</span>
      <span className="agent-kind-rail-count">{count}</span>
    </Link>
  );
}

function showsInstruction(
  inventory: AgentInventory,
  filters: AgentSetupFilters,
): boolean {
  if (!inventory.instructionFile) return false;
  if (filters.kind && filters.kind !== "instruction") return false;
  if (filters.status) return false;
  if (!filters.q) return true;
  const query = filters.q.toLocaleLowerCase();
  return [
    inventory.instructionFile.filename,
    inventory.instructionFile.sourcePath,
  ].some((value) => value.toLocaleLowerCase().includes(query));
}

function SourceGroup({
  origin,
  capabilities,
  duplicateNames,
}: {
  origin: AgentCapability["origin"];
  capabilities: AgentCapability[];
  duplicateNames: Set<string>;
}) {
  const items = buildInventoryItems(capabilities).sort(compareInventoryItems);
  return (
    <details className="agent-source-group" open>
      <summary>
        <span className="agent-source-group-primary">
          <span className={`badge ${originBadges[origin]} agent-origin-tag`}>
            {originLabels[origin]}
          </span>
        </span>
        <span>{countLabel(capabilities.length, "item")}</span>
      </summary>
      <div className="agent-source-group-body">
        {items.map((item) =>
          item.kind === "row" ? (
            <CapabilityRow
              key={`row:${item.capability.id}`}
              capability={item.capability}
              duplicateNames={duplicateNames}
            />
          ) : (
            <CapabilityGroup
              key={`group:${item.summary.key}`}
              summary={item.summary}
              members={item.members}
              duplicateNames={duplicateNames}
            />
          ),
        )}
      </div>
    </details>
  );
}

function CapabilityRow({
  capability,
  duplicateNames,
  withinGroup,
}: {
  capability: AgentCapability;
  duplicateNames?: Set<string>;
  withinGroup?: boolean;
}) {
  // When the same capability name appears more than once in the visible
  // inventory, the source line alone can't tell the rows apart (e.g. two
  // ai-sdk installs both reclassified to skills.sh/vercel/ai). Surface the
  // shortened install path so the user can identify and clean up duplicates.
  const showPathHint =
    duplicateNames?.has(capability.name) && !!capability.sourcePath;
  // Inside a repo/plugin sub-group the header already names the source, so a
  // per-row source line just repeats it. For standalone rows the source line
  // is the row's only locator — but only when it carries information the name
  // does not. Plugin/MCP rows are published as "<name>@<marketplace>" with
  // sourceRepository === "<marketplace>", so the repository line just repeats
  // the @-suffix; skills.sh rows keep their line because the repository
  // (e.g. "vercel/ai") is a real locator the skill name doesn't convey.
  const repository = capability.sourceRepository;
  const nameSuffix = capability.name.includes("@")
    ? capability.name.slice(capability.name.lastIndexOf("@") + 1)
    : undefined;
  const redundantRepository =
    withinGroup || (nameSuffix !== undefined && repository === nameSuffix);
  const sourceLine = redundantRepository
    ? undefined
    : (repository ?? capability.sourcePlugin);

  return (
    <div className="agent-capability-row">
      <div className="agent-capability-primary">
        <strong>{capability.name}</strong>
        {sourceLine ? <span>{sourceLine}</span> : null}
        {showPathHint ? (
          <code className="agent-capability-path-hint">
            {shortenHomePath(capability.sourcePath!)}
          </code>
        ) : null}
      </div>
    </div>
  );
}

function CapabilityGroup({
  summary,
  members,
  duplicateNames,
}: {
  summary: SkillGroupSummary;
  members: AgentCapability[];
  duplicateNames?: Set<string>;
}) {
  return (
    <details className="agent-capability-group">
      <summary>
        <span className="agent-capability-group-primary">
          <strong>{summary.name}</strong>
        </span>
        <span>{countLabel(summary.memberCount, "skill")}</span>
      </summary>
      <div className="agent-capability-group-members">
        {members.map((capability) => (
          <CapabilityRow
            key={capability.id}
            capability={capability}
            duplicateNames={duplicateNames}
            withinGroup
          />
        ))}
      </div>
    </details>
  );
}

function ComparisonView({
  inventories,
  filters,
}: {
  inventories: AgentInventory[];
  filters: AgentSetupFilters;
}) {
  let rows = buildComparisonRows(inventories);
  if (filters.q) {
    const query = filters.q.toLocaleLowerCase();
    rows = rows.filter((row) => row.name.toLocaleLowerCase().includes(query));
  }
  if (filters.kind) rows = rows.filter((row) => row.kind === filters.kind);
  if (filters.provider) {
    rows = rows.filter(
      (row) =>
        row.cells[filters.provider!] ||
        row.instructionCells?.[filters.provider!],
    );
  }
  if (filters.status) {
    rows = rows.filter((row) =>
      Object.values(row.cells).some(
        (capability) => capability.status === filters.status,
      ),
    );
  }
  const fixCount = rows.filter((row) => row.assessment.level === "fix").length;
  const reviewCount = rows.filter(
    (row) => row.assessment.level === "review",
  ).length;

  if (filters.comparisonMode === "attention") {
    rows = rows
      .filter((row) => row.assessment.level !== "context")
      .sort(
        (left, right) =>
          assessmentOrder[left.assessment.level] -
            assessmentOrder[right.assessment.level] ||
          comparisonKindSortOrder[left.kind] -
            comparisonKindSortOrder[right.kind] ||
          left.name.localeCompare(right.name),
      );
  } else if (filters.discrepanciesOnly) {
    rows = rows.filter((row) => row.isDiscrepancy);
  }

  const attentionInventories = filters.provider
    ? inventories.filter((inventory) => inventory.provider === filters.provider)
    : inventories;
  const duplicates =
    filters.comparisonMode === "attention"
      ? findComparisonDuplicates(attentionInventories)
      : [];
  // Warnings mean the inventory itself may be incomplete (malformed config,
  // stale artifacts) — the highest-severity condition the discovery layer can
  // report, so the attention view leads with them. Shared-source warnings
  // (e.g. the skills.sh lockfile) repeat on every provider; dedupe by content.
  const attentionWarnings =
    filters.comparisonMode === "attention"
      ? [
          ...new Map(
            attentionInventories
              .flatMap((inventory) => inventory.warnings)
              .map(
                (warning) =>
                  [
                    `${warning.sourcePath}:${warning.code}:${warning.message}`,
                    warning,
                  ] as const,
              ),
          ).values(),
        ]
      : [];

  // Fixes share one section — they are all "this is broken, repair it".
  // Reviews are judgement calls whose remedy depends entirely on the cause, so
  // each reason gets its own section rather than one undifferentiated pile.
  const comparisonGroups = filters.comparisonMode
    ? [
        {
          id: "fix",
          level: "fix",
          label: "Fixes",
          rows: rows.filter((row) => row.assessment.level === "fix"),
        },
        ...reviewSections.map((section) => ({
          id: `review:${section.reason}`,
          level: "review",
          label: section.label,
          rows: rows.filter(
            (row) =>
              row.assessment.level === "review" &&
              row.assessment.reason === section.reason,
          ),
        })),
      ].filter((group) => group.rows.length > 0)
    : [{ id: "all", level: "all", label: undefined, rows }];

  return (
    <>
      <div className="agent-comparison-toolbar">
        <nav className="agent-comparison-switcher" aria-label="Comparison mode">
          <Link
            href={setupHref(filters, {
              comparisonMode: "attention",
              discrepanciesOnly: undefined,
            })}
            className={
              filters.comparisonMode === "attention"
                ? "agent-comparison-tab agent-comparison-tab-active"
                : "agent-comparison-tab"
            }
            aria-current={
              filters.comparisonMode === "attention" ? "page" : undefined
            }
          >
            Needs attention
          </Link>
          <Link
            href={setupHref(filters, {
              comparisonMode: undefined,
              discrepanciesOnly: undefined,
            })}
            className={
              filters.comparisonMode
                ? "agent-comparison-tab"
                : "agent-comparison-tab agent-comparison-tab-active"
            }
            aria-current={filters.comparisonMode ? undefined : "page"}
          >
            Complete matrix
          </Link>
        </nav>
        <div className="agent-attention-summary" aria-label="Attention summary">
          <span className="badge badge-5">
            {countLabel(fixCount, "fix", "fixes")}
          </span>
          <span className="badge badge-4">
            {countLabel(reviewCount, "review")}
          </span>
        </div>
      </div>

      {attentionWarnings.length > 0 ? (
        <section className="card agent-provider-section">
          <header className="agent-provider-heading">
            <div>
              <strong>Configuration warnings</strong>
            </div>
            <span>Discovery could not fully trust these sources</span>
          </header>
          <div className="agent-warning-list">
            {attentionWarnings.map((warning: InventoryWarning) => (
              <div
                key={`${warning.sourcePath}:${warning.code}:${warning.message}`}
                className="notice"
              >
                <AlertTriangle size={14} />
                <span>{warning.message}</span>
                <code>{warning.sourcePath}</code>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {/* Warnings and duplicates are both agent-local inventory hygiene: short,
          high-severity, and fixable without consulting the other agents. They
          lead together, ahead of the long cross-agent matrix. */}
      {duplicates.length > 0 ? (
        <DuplicatesSection duplicates={duplicates} />
      ) : null}
      {rows.length === 0 ? (
        <div className="card empty-state agent-empty-state">
          <h3>
            {filters.comparisonMode === "attention"
              ? "No consensus drift needs attention."
              : "No comparison rows match these filters."}
          </h3>
          <p>
            {filters.comparisonMode === "attention"
              ? "The current setup has no Fix or Review items for these filters."
              : "Adjust the filters or include matching configurations."}
          </p>
          {filters.comparisonMode === "attention" ? (
            <Link
              className="btn btn-outline"
              href={setupHref(filters, { comparisonMode: undefined })}
            >
              Complete matrix
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="card agent-comparison-region" tabIndex={0}>
          <table className="agent-comparison-table">
            <colgroup>
              <col className="agent-comparison-capability-column" />
              {agentProviders.map((provider) => (
                <col
                  className="agent-comparison-provider-column"
                  key={provider}
                />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Capability</th>
                {agentProviders.map((provider) => (
                  <th scope="col" key={provider}>
                    {providerLabels[provider]}
                  </th>
                ))}
              </tr>
            </thead>
            {comparisonGroups.map((group) => (
              <tbody key={group.id}>
                {group.label ? (
                  <tr
                    className={`agent-comparison-group-row agent-comparison-group-${group.level}`}
                  >
                    <th scope="rowgroup" colSpan={agentProviders.length + 1}>
                      <span>{group.label}</span>
                      <span>{group.rows.length}</span>
                    </th>
                  </tr>
                ) : null}
                {group.rows.map((row) => (
                  <ComparisonTableRow
                    key={row.key}
                    row={row}
                    showAssessment={filters.comparisonMode === "attention"}
                  />
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </>
  );
}

function DuplicatesSection({
  duplicates,
}: {
  duplicates: ComparisonDuplicate[];
}) {
  return (
    <section className="card agent-provider-section">
      <header className="agent-provider-heading">
        <div>
          <strong>Duplicate installs</strong>
        </div>
        <span>Same capability installed more than once in a single agent</span>
      </header>
      <div className="agent-duplicate-region">
        <table className="agent-duplicate-table">
          <thead>
            <tr>
              <th scope="col">Agent</th>
              <th scope="col">Capability</th>
              <th scope="col">Assessment</th>
              <th scope="col">Locations</th>
            </tr>
          </thead>
          <tbody>
            {duplicates.map((duplicate) => (
              <tr
                key={`${duplicate.provider}:${duplicate.kind}:${duplicate.name}`}
              >
                <td>
                  <span
                    className={`badge ${providerBadges[duplicate.provider]}`}
                  >
                    {providerLabels[duplicate.provider]}
                  </span>
                </td>
                <td>
                  <span className="agent-duplicate-name">{duplicate.name}</span>
                  <span className="agent-duplicate-kind">
                    {capabilityKindLabels[duplicate.kind]}
                  </span>
                </td>
                <td>
                  {duplicate.identicalContent ? (
                    <span className="agent-duplicate-verdict">Redundant</span>
                  ) : (
                    <span className="badge badge-4">Shadowed</span>
                  )}
                  <span className="agent-duplicate-hint">
                    {duplicate.identicalContent
                      ? "Removing all but one is safe."
                      : "Copies differ — pick which one wins."}
                  </span>
                </td>
                <td>
                  {duplicate.copies.map((copy) =>
                    copy.sourcePath ? (
                      <code key={copy.id}>
                        {shortenHomePath(copy.sourcePath)}
                      </code>
                    ) : null,
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ComparisonTableRow({
  row,
  showAssessment,
}: {
  row: ComparisonRow;
  showAssessment: boolean;
}) {
  const KindIcon = kindIcons[row.kind];
  const origins = new Set(
    Object.values(row.cells).map((capability) => capability.origin),
  );
  const sharedOrigin =
    origins.size === 1 ? origins.values().next().value : undefined;

  return (
    <tr className={row.isDiscrepancy ? "agent-row-discrepancy" : undefined}>
      <th scope="row">
        <div className="agent-comparison-name">{row.name}</div>
        <div className="agent-comparison-metadata">
          <span
            className={`agent-kind-label ${kindMarkers[row.kind]} agent-comparison-kind`}
          >
            <KindIcon aria-hidden="true" size={12} />
            {capabilityKindLabels[row.kind]}
          </span>
          {sharedOrigin ? (
            <>
              <span className="agent-comparison-separator" aria-hidden="true">
                ·
              </span>
              <span className="agent-comparison-origin">
                {originLabels[sharedOrigin]}
              </span>
            </>
          ) : origins.size > 1 ? (
            <>
              <span className="agent-comparison-separator" aria-hidden="true">
                ·
              </span>
              <span className="agent-comparison-origin agent-origin-mixed">
                Mixed sources
              </span>
            </>
          ) : null}
        </div>
        {/* Reviews are grouped into per-reason sections whose headings carry
            the reason, and the provider cells carry the specifics — a message
            here would only repeat both. Fixes share one section, so they still
            need their message to say what is broken. */}
        {showAssessment && row.assessment.level === "fix" ? (
          <span className="agent-assessment-reason">
            {row.assessment.message}
          </span>
        ) : null}
      </th>
      {row.isUniformAcrossProviders ? (
        <UniformComparisonCell row={row} />
      ) : (
        agentProviders.map((provider) => {
          const instruction = row.instructionCells?.[provider];
          const capability = row.cells[provider];
          const visibleSource = capability
            ? capabilitySourceLabel(capability)
            : undefined;
          const StatusIcon =
            capability?.status === "disabled"
              ? CircleSlash2
              : capability?.status === "unavailable"
                ? CircleX
                : Check;
          return (
            <td key={provider}>
              {instruction ? (
                <details className="agent-compare-detail">
                  <summary className="agent-instruction-summary">
                    <span>
                      <Check size={13} /> {instruction.filename}
                    </span>
                  </summary>
                  <code>{instruction.sourcePath}</code>
                  <pre>{instruction.content}</pre>
                </details>
              ) : capability ? (
                <>
                  <details className="agent-compare-detail">
                    <summary
                      className={`agent-status-tag ${statusBadges[capability.status]}`}
                    >
                      <StatusIcon size={13} /> {statusLabels[capability.status]}
                    </summary>
                    <span>{originLabels[capability.origin]}</span>
                    <span>{capability.packaging.replace("_", " ")}</span>
                    {capability.sourceRepository &&
                    capability.sourceRepository !== visibleSource ? (
                      <code>{capability.sourceRepository}</code>
                    ) : null}
                    {capability.sourcePath ? (
                      <code>{capability.sourcePath}</code>
                    ) : null}
                  </details>
                  {visibleSource ? (
                    <span className="agent-compare-source">
                      {visibleSource}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="agent-missing agent-status-tag agent-status-missing">
                  <Minus size={13} /> Missing
                </span>
              )}
            </td>
          );
        })
      )}
    </tr>
  );
}

function UniformComparisonCell({ row }: { row: ComparisonRow }) {
  const capability = row.cells[agentProviders[0]]!;
  const visibleSource = capabilitySourceLabel(capability);
  const StatusIcon =
    capability.status === "disabled"
      ? CircleSlash2
      : capability.status === "unavailable"
        ? CircleX
        : Check;

  return (
    <td colSpan={agentProviders.length} className="agent-all-agents-cell">
      <details className="agent-compare-detail agent-all-agents-detail">
        <summary
          className={`agent-status-tag ${statusBadges[capability.status]}`}
        >
          <StatusIcon size={13} /> All agents ·{" "}
          {statusLabels[capability.status]}
        </summary>
        <span>{originLabels[capability.origin]}</span>
        <span>{capability.packaging.replace("_", " ")}</span>
        {capability.sourceRepository &&
        capability.sourceRepository !== visibleSource ? (
          <code>{capability.sourceRepository}</code>
        ) : null}
      </details>
      {visibleSource ? (
        <span className="agent-compare-source">{visibleSource}</span>
      ) : null}
    </td>
  );
}

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

/**
 * Third `/agents` tab. Renders all discovered scheduled/recurring tasks in a
 * single schedule-first table (sorted by cadence, active tasks first). Empty
 * providers contribute no rows and render nothing. Each row is a native
 * `<details name="agent-tasks">` so only one row is open at a time (exclusive
 * accordion) with zero client-side JavaScript. The KindRail is scoped to
 * InventoryView so it does not render here.
 */
function ScheduledTasksView({
  inventories,
}: {
  inventories: AgentInventory[];
}) {
  const tasks = inventories
    .flatMap((inventory) => inventory.scheduledTasks ?? [])
    .sort(compareScheduledTasks);
  const total = tasks.length;
  return (
    <div className="agent-inventory-list">
      {total === 0 ? (
        <p className="agent-tasks-summary">
          No scheduled tasks found across agents.
        </p>
      ) : (
        <div className="agent-task-table">
          <div className="agent-task-head">
            <span aria-hidden="true" />
            <span>Schedule</span>
            <span>Task</span>
            <span>Agent</span>
            <span>Status</span>
          </div>
          {tasks.map((task) => (
            <ScheduledTaskDetails
              key={`${task.provider}:${task.id}`}
              task={task}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ScheduledTaskDetails({ task }: { task: ScheduledTask }) {
  const schedule = task.scheduleHuman ?? task.scheduleRaw;
  return (
    <details name="agent-tasks" className="agent-task-row">
      <summary className="agent-task-summary">
        <span className="agent-task-sched">
          {schedule ?? "Schedule not specified"}
          {task.scheduleMissing ? (
            <em className="agent-tasks-hint"> (no schedule configured)</em>
          ) : null}
        </span>
        <strong className="agent-task-name">{task.name}</strong>
        <span className={`badge ${providerBadges[task.provider]}`}>
          {providerLabels[task.provider]}
        </span>
        <span
          className={`badge ${scheduledStatusBadges[task.status]} agent-status-tag`}
        >
          {scheduledStatusLabels[task.status]}
        </span>
      </summary>
      <div className="agent-task-detail">
        <div className="agent-task-meta">
          {task.model ? (
            <span>
              Model: <code>{task.model}</code>
            </span>
          ) : null}
          <span>
            Source: <code>{shortenHomePath(task.sourcePath)}</code>
          </span>
        </div>
        {task.instructionBody ? (
          <pre className="agent-task-instruction">{task.instructionBody}</pre>
        ) : null}
      </div>
    </details>
  );
}
