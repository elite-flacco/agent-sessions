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
  type ComparisonDuplicate,
  type ComparisonRow,
  type InventoryWarning,
} from "@/lib/agent-inventory";
import { providerBadges, providerLabels } from "@/lib/labels";
import { shortenHomePath } from "@/lib/format";
import { agentProviders, type AgentProvider } from "@/lib/types";

export type AgentSetupViewMode = "inventory" | "compare";
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
    view: first(params.view) === "compare" ? "compare" : "inventory",
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
): boolean {
  if (filters.kind && filters.kind !== capability.kind) return false;
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
    originLabels[left.origin].localeCompare(originLabels[right.origin]) ||
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
    originLabels[leftCapability.origin].localeCompare(
      originLabels[rightCapability.origin],
    ) ||
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
  origin: "marketplace" | "skills_sh";
  statusAggregate:
    | { kind: "uniform"; status: CapabilityStatus }
    | { kind: "mixed"; notEnabledCount: number };
}

/**
 * Build the summary that `CapabilityGroup` renders in its <summary>. Members
 * must share a group key (caller's responsibility). Name, origin, and kind
 * are derived from the first member; status is aggregated across all
 * members so the summary stays informative when the group is collapsed.
 */
function summarizeSkillGroup(members: AgentCapability[]): SkillGroupSummary {
  const first = members[0]!;
  const key = skillGroupKey(first)!;
  const statuses = new Set(members.map((member) => member.status));
  const statusAggregate: SkillGroupSummary["statusAggregate"] =
    statuses.size === 1
      ? { kind: "uniform", status: first.status }
      : {
          kind: "mixed",
          notEnabledCount: members.filter(
            (member) => member.status !== "enabled",
          ).length,
        };
  if (first.origin === "marketplace" && first.sourcePlugin) {
    return {
      key,
      kind: "plugin",
      name: first.sourcePlugin,
      memberCount: members.length,
      origin: "marketplace",
      statusAggregate,
    };
  }
  return {
    key,
    kind: "skills_sh",
    name: first.sourceRepository!,
    memberCount: members.length,
    origin: "skills_sh",
    statusAggregate,
  };
}

type InventoryItem =
  | { kind: "row"; capability: AgentCapability }
  | { kind: "group"; summary: SkillGroupSummary; members: AgentCapability[] };

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
            active={filters.provider === inventory.provider}
            href={setupHref(filters, {
              provider:
                filters.provider === inventory.provider
                  ? undefined
                  : inventory.provider,
            })}
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
      </nav>

      <FilterForm filters={filters} />

      {filters.view === "compare" ? (
        <ComparisonView inventories={inventories} filters={filters} />
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
  const counts = Object.fromEntries(
    (["plugin", "skill", "mcp"] as const).map((kind) => [
      kind,
      inventory.capabilities.filter((capability) => capability.kind === kind)
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
      <strong>{inventory.capabilities.length} capabilities</strong>
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
      <label className="agent-filter">
        <span>Status</span>
        <select
          className="select"
          name="status"
          defaultValue={filters.status ?? ""}
        >
          <option value="">All statuses</option>
          {Object.entries(statusLabels).map(([value, label]) => (
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

function InventoryView({
  inventories,
  filters,
}: {
  inventories: AgentInventory[];
  filters: AgentSetupFilters;
}) {
  const visible = inventories.filter(
    (inventory) => !filters.provider || inventory.provider === filters.provider,
  );
  const matchCount = visible.reduce(
    (total, inventory) =>
      total +
      inventory.capabilities.filter((capability) =>
        matchesCapability(capability, filters),
      ).length +
      (showsInstruction(inventory, filters) ? 1 : 0),
    0,
  );

  if (matchCount === 0) {
    return (
      <div className="card empty-state agent-empty-state">
        <h3>No capabilities match these filters.</h3>
        <p>Adjust the search, agent, type, or status selection.</p>
      </div>
    );
  }

  return (
    <div className="agent-inventory-list">
      {visible.map((inventory) => (
        <ProviderInventory
          key={inventory.provider}
          inventory={inventory}
          filters={filters}
        />
      ))}
    </div>
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

function ProviderInventory({
  inventory,
  filters,
}: {
  inventory: AgentInventory;
  filters: AgentSetupFilters;
}) {
  const capabilities = inventory.capabilities
    .filter((capability) => matchesCapability(capability, filters))
    .sort(compareInventoryCapabilities);
  const items = buildInventoryItems(capabilities).sort(compareInventoryItems);
  // Names that appear on more than one visible capability (across groups and
  // flat rows alike). For those rows we surface a shortened sourcePath so the
  // user can tell duplicate installs apart and clean them up.
  const duplicateNames = new Set<string>();
  const nameCounts = new Map<string, number>();
  for (const capability of capabilities) {
    nameCounts.set(capability.name, (nameCounts.get(capability.name) ?? 0) + 1);
  }
  for (const [name, count] of nameCounts) {
    if (count > 1) duplicateNames.add(name);
  }
  const instructionVisible = showsInstruction(inventory, filters);
  if (
    capabilities.length === 0 &&
    !instructionVisible &&
    inventory.warnings.length === 0
  ) {
    return null;
  }

  return (
    <section className="card agent-provider-section">
      <header className="agent-provider-heading">
        <div>
          <span className={`badge ${providerBadges[inventory.provider]}`}>
            {providerLabels[inventory.provider]}
          </span>
          <strong>{capabilities.length} shown</strong>
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
      {items.length > 0 ? (
        <div className="agent-capability-list">
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
      ) : null}
      {instructionVisible && inventory.instructionFile ? (
        <details className="agent-instruction">
          <summary>
            <strong className="agent-instruction-title">
              {inventory.instructionFile.filename}
            </strong>
            <span>{inventory.instructionFile.sourcePath}</span>
          </summary>
          <pre>{inventory.instructionFile.content}</pre>
        </details>
      ) : null}
    </section>
  );
}

function CapabilityRow({
  capability,
  duplicateNames,
}: {
  capability: AgentCapability;
  duplicateNames?: Set<string>;
}) {
  const KindIcon = kindIcons[capability.kind];
  const StatusIcon =
    capability.status === "disabled"
      ? CircleSlash2
      : capability.status === "unavailable"
        ? CircleX
        : Check;
  // When the same capability name appears more than once in the visible
  // inventory, the source line alone can't tell the rows apart (e.g. two
  // ai-sdk installs both reclassified to skills.sh/vercel/ai). Surface the
  // shortened install path so the user can identify and clean up duplicates.
  const showPathHint =
    duplicateNames?.has(capability.name) && !!capability.sourcePath;
  const sourceLine =
    capability.sourceRepository ??
    capability.sourcePlugin ??
    capability.sourcePath;

  return (
    <div className="agent-capability-row">
      <div className="agent-capability-primary">
        <strong>{capability.name}</strong>
        <span>{sourceLine}</span>
        {showPathHint ? (
          <code className="agent-capability-path-hint">
            {shortenHomePath(capability.sourcePath!)}
          </code>
        ) : null}
      </div>
      <span className={`agent-kind-label ${kindMarkers[capability.kind]}`}>
        <KindIcon aria-hidden="true" size={12} />
        {capabilityKindLabels[capability.kind]}
      </span>
      <span
        className={`badge ${originBadges[capability.origin]} agent-origin-tag`}
      >
        {originLabels[capability.origin]}
      </span>
      <span className={`agent-status-tag ${statusBadges[capability.status]}`}>
        <StatusIcon size={13} /> {statusLabels[capability.status]}
      </span>
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
  const GroupIcon = summary.kind === "plugin" ? Plug : WandSparkles;
  const statusText =
    summary.statusAggregate.kind === "uniform"
      ? statusLabels[summary.statusAggregate.status]
      : `Mixed · ${summary.statusAggregate.notEnabledCount} not enabled`;
  const statusClass =
    summary.statusAggregate.kind === "uniform"
      ? statusBadges[summary.statusAggregate.status]
      : "badge-4";

  return (
    <details className="agent-capability-group">
      <summary>
        <span className="agent-capability-group-primary">
          <GroupIcon aria-hidden="true" size={14} />
          <strong>{summary.name}</strong>
        </span>
        <span>{countLabel(summary.memberCount, "skill")}</span>
        <span
          className={`badge ${originBadges[summary.origin]} agent-origin-tag`}
        >
          {originLabels[summary.origin]}
        </span>
        <span className={`agent-status-tag ${statusClass}`}>{statusText}</span>
      </summary>
      <div className="agent-capability-group-members">
        {members.map((capability) => (
          <CapabilityRow
            key={capability.id}
            capability={capability}
            duplicateNames={duplicateNames}
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

  const comparisonGroups = filters.comparisonMode
    ? (["fix", "review"] as const)
        .map((level) => ({
          key: level,
          label: level === "fix" ? "Fixes" : "Reviews",
          rows: rows.filter((row) => row.assessment.level === level),
        }))
        .filter((group) => group.rows.length > 0)
    : [{ key: "all", label: undefined, rows }];

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
              <tbody key={group.key}>
                {group.label ? (
                  <tr
                    className={`agent-comparison-group-row agent-comparison-group-${group.key}`}
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
      {duplicates.length > 0 ? (
        <DuplicatesSection duplicates={duplicates} />
      ) : null}
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
      <div className="agent-warning-list">
        {duplicates.map((duplicate) => (
          <div
            key={`${duplicate.provider}:${duplicate.kind}:${duplicate.name}`}
            className="notice"
          >
            <AlertTriangle size={14} />
            <span>
              <span className={`badge ${providerBadges[duplicate.provider]}`}>
                {providerLabels[duplicate.provider]}
              </span>{" "}
              <strong>{duplicate.name}</strong> —{" "}
              {duplicate.identicalContent
                ? "Identical copies; removing all but one is safe."
                : "Copies differ; one may shadow the other, so pick which should win."}
            </span>
            {duplicate.copies.map((copy) =>
              copy.sourcePath ? (
                <code key={copy.id}>{shortenHomePath(copy.sourcePath)}</code>
              ) : null,
            )}
          </div>
        ))}
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
