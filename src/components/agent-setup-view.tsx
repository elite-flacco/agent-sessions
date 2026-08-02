import {
  AlertTriangle,
  Boxes,
  Check,
  CircleSlash2,
  CircleX,
  FileText,
  Minus,
  PackageOpen,
  Plug,
  Search,
  UserRound,
  WandSparkles,
  Waypoints,
  X,
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
type InventorySource =
  "standalone" | "plugin" | "built_in" | "marketplace" | "personal";

export interface AgentSetupFilters {
  view: AgentSetupViewMode;
  comparisonMode?: "attention";
  q?: string;
  provider?: AgentProvider;
  kind?: AgentSetupKind;
  source?: InventorySource;
  status?: CapabilityStatus;
  selected?: string;
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

const inventorySources: InventorySource[] = [
  "standalone",
  "plugin",
  "built_in",
  "marketplace",
  "personal",
];

const inventorySourceMeta: Record<
  InventorySource,
  { label: string; description: string; icon: LucideIcon }
> = {
  standalone: {
    label: "Standalone",
    description: "Installed directly, not supplied by a plugin",
    icon: WandSparkles,
  },
  plugin: {
    label: "Plugin-provided",
    description: "Bundled with enabled plugins",
    icon: Plug,
  },
  built_in: {
    label: "Built-in",
    description: "Included with the agent runtime",
    icon: Boxes,
  },
  marketplace: {
    label: "Marketplace",
    description: "Installed through a marketplace or skills manager",
    icon: PackageOpen,
  },
  personal: {
    label: "Personal",
    description: "Maintained in the user’s personal skill collection",
    icon: UserRound,
  },
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
  const source = first(params.source);
  const status = first(params.status);
  const view =
    first(params.view) === "compare"
      ? "compare"
      : first(params.view) === "tasks"
        ? "tasks"
        : "inventory";
  // Compare spans every provider by design, so a provider param is meaningless
  // there. Drop it at the boundary rather than letting it leak into the summary
  // cards and tab links as a selection that filters nothing.
  const scopedProvider = view === "compare" ? undefined : provider;
  return {
    view,
    comparisonMode:
      first(params.comparison) === "attention" ? "attention" : undefined,
    q: first(params.q)?.trim() || undefined,
    provider: agentProviders.includes(scopedProvider as AgentProvider)
      ? (scopedProvider as AgentProvider)
      : undefined,
    kind: ["plugin", "skill", "mcp", "instruction"].includes(kind ?? "")
      ? (kind as AgentSetupKind)
      : undefined,
    source:
      view === "inventory" &&
      inventorySources.includes(source as InventorySource)
        ? (source as InventorySource)
        : undefined,
    status: ["enabled", "installed", "disabled", "unavailable"].includes(
      status ?? "",
    )
      ? (status as CapabilityStatus)
      : undefined,
    selected: view === "inventory" ? first(params.selected) : undefined,
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
  if (next.view === "inventory" && next.source) {
    params.set("source", next.source);
  }
  if (next.status) params.set("status", next.status);
  if (next.view === "inventory" && next.selected) {
    params.set("selected", next.selected);
  }
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

function inventorySourceFor(capability: AgentCapability): InventorySource {
  if (capability.packaging === "plugin" || capability.sourcePlugin) {
    return "plugin";
  }
  if (capability.packaging === "built_in" || capability.origin === "built_in") {
    return "built_in";
  }
  if (
    capability.origin === "marketplace" ||
    capability.origin === "skills_sh"
  ) {
    return "marketplace";
  }
  if (capability.origin === "personal") return "personal";
  return "standalone";
}

function compareCatalogCapabilities(
  left: AgentCapability,
  right: AgentCapability,
): number {
  return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
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

      <nav className="workspace-switcher" aria-label="Agent setup view">
        <Link
          href={setupHref(filters, {
            view: "inventory",
            comparisonMode: undefined,
            discrepanciesOnly: undefined,
            source: undefined,
            selected: undefined,
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
            source: undefined,
            selected: undefined,
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
            source: undefined,
            selected: undefined,
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

      <AgentSetupContextSummary inventories={inventories} filters={filters} />
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

interface ContextSummaryMetric {
  value: string;
  label: string;
  tone?: "success" | "warning" | "danger";
}

function ContextSummary({
  ariaLabel,
  title,
  metrics,
}: {
  ariaLabel: string;
  title: string;
  metrics: ContextSummaryMetric[];
}) {
  return (
    <section className="agent-context-summary" aria-label={ariaLabel}>
      <strong>{title}</strong>
      <ul className="agent-context-metrics" aria-label={`${title} metrics`}>
        {metrics.map((metric) => (
          <li
            key={`${metric.value}:${metric.label}`}
            className={
              metric.tone
                ? `agent-context-metric is-${metric.tone}`
                : "agent-context-metric"
            }
          >
            <strong>{metric.value}</strong> <span>{metric.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function metricLabel(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return count === 1 ? singular : plural;
}

function AgentSetupContextSummary({
  inventories,
  filters,
}: AgentSetupViewProps) {
  if (filters.view === "inventory") {
    const inventory =
      inventories.find((entry) => entry.provider === filters.provider) ??
      inventories[0];
    if (!inventory) return null;
    const activeCapabilities = inventory.capabilities.filter(
      (capability) => capability.status !== "disabled",
    );
    const activeSkills = activeCapabilities.filter(
      (capability) => capability.kind === "skill",
    );
    const skillSourceCount = new Set(activeSkills.map(inventorySourceFor)).size;
    return (
      <ContextSummary
        ariaLabel="Inventory summary"
        title={`${providerLabels[inventory.provider]} inventory`}
        metrics={[
          {
            value: String(activeCapabilities.length),
            label: metricLabel(
              activeCapabilities.length,
              "capability",
              "capabilities",
            ),
          },
          {
            value: String(activeSkills.length),
            label: metricLabel(activeSkills.length, "skill"),
          },
          {
            value: String(skillSourceCount),
            label: metricLabel(skillSourceCount, "source"),
          },
          {
            value: inventory.instructionFile?.filename ?? "Unavailable",
            label: "instructions",
          },
        ]}
      />
    );
  }

  if (filters.view === "compare") {
    const rows = filteredComparisonRows(inventories, filters);
    const fixCount = rows.filter(
      (row) => row.assessment.level === "fix",
    ).length;
    const reviewCount = rows.filter(
      (row) => row.assessment.level === "review",
    ).length;
    const duplicateCount = findComparisonDuplicates(inventories).length;
    return (
      <ContextSummary
        ariaLabel="Comparison summary"
        title="Setup comparison"
        metrics={[
          {
            value: String(inventories.length),
            label: metricLabel(inventories.length, "agent"),
          },
          {
            value: String(fixCount),
            label: metricLabel(fixCount, "fix", "fixes"),
            tone: fixCount > 0 ? "danger" : undefined,
          },
          {
            value: String(reviewCount),
            label: metricLabel(reviewCount, "review"),
            tone: reviewCount > 0 ? "warning" : undefined,
          },
          {
            value: String(duplicateCount),
            label: metricLabel(duplicateCount, "duplicate install"),
            tone: duplicateCount > 0 ? "warning" : undefined,
          },
        ]}
      />
    );
  }

  const tasks = scheduledTasksFor(inventories);
  const activeCount = tasks.filter((task) => task.status === "active").length;
  const inactiveCount = tasks.filter(
    (task) => task.status === "paused" || task.status === "disabled",
  ).length;
  const orphanedCount = tasks.filter((task) =>
    task.warnings.some((warning) => warning.code === "orphaned"),
  ).length;
  return (
    <ContextSummary
      ariaLabel="Scheduled tasks summary"
      title="Task health"
      metrics={[
        {
          value: String(tasks.length),
          label: metricLabel(tasks.length, "task"),
        },
        {
          value: String(activeCount),
          label: "active",
          tone: activeCount > 0 ? "success" : undefined,
        },
        {
          value: String(inactiveCount),
          label: "paused or disabled",
          tone: inactiveCount > 0 ? "warning" : undefined,
        },
        {
          value: String(orphanedCount),
          label: `${metricLabel(orphanedCount, "target")} missing`,
          tone: orphanedCount > 0 ? "danger" : undefined,
        },
      ]}
    />
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
        // Compare is a provider-by-provider matrix, so it has no Agent filter:
        // every row already spans all providers, and narrowing to one would
        // drop the missing-from-that-provider rows that drift analysis is for.
        <label className="agent-filter">
          <span className="sr-only">Type</span>
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
      ) : (
        <>
          {/* Inventory selects provider and kind in the rail; preserve both
              so a Status change or search keeps the current view. */}
          {filters.provider ? (
            <input type="hidden" name="provider" value={filters.provider} />
          ) : null}
          {filters.kind ? (
            <input type="hidden" name="kind" value={filters.kind} />
          ) : null}
          <label className="agent-filter">
            <span className="sr-only">Source</span>
            <select
              className="select"
              name="source"
              defaultValue={filters.source ?? ""}
            >
              <option value="">All sources</option>
              {inventorySources.map((source) => (
                <option key={source} value={source}>
                  {inventorySourceMeta[source].label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <label className="agent-filter">
        <span className="sr-only">Status</span>
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

// The Inventory view shows one provider at a time. Provider and kind stay in a
// compact browsing rail while source, status, and search remain in the stable
// toolbar above the catalog.
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

  // Status + search + source filtered, but NOT kind — the rail owns kind
  // selection and therefore remains visible while the catalog changes.
  const matched = inventory.capabilities
    .filter((capability) => matchesCapability(capability, filters, true))
    .filter(
      (capability) =>
        !filters.source || inventorySourceFor(capability) === filters.source,
    )
    .sort(compareCatalogCapabilities);

  const kindCounts = Object.fromEntries(
    RAIL_KINDS.map((kind) => [
      kind,
      matched.filter((capability) => capability.kind === kind).length,
    ]),
  ) as Record<(typeof RAIL_KINDS)[number], number>;
  // The rail entry renders whenever the provider ships an instruction file, so
  // selecting another kind never hides it. Whether the instruction *matches*
  // the active status/search filters is a separate question, and only decides
  // whether it can stand in as a result when nothing else does.
  const hasInstruction = Boolean(inventory.instructionFile);
  const instructionMatches = showsInstruction(inventory, filters);

  // Honour explicit rail selections even when the active filters produce an
  // empty pane. Without that, filtering Skills could unexpectedly jump to MCPs.
  const requested = filters.kind;
  const selectedKind: AgentSetupKind =
    requested === "instruction" && hasInstruction
      ? "instruction"
      : requested && requested !== "instruction"
        ? requested
        : (RAIL_KINDS.find((kind) => kindCounts[kind] > 0) ??
          (instructionMatches ? "instruction" : "skill"));

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

  const selectedCapability = filters.selected
    ? inventory.capabilities.find(
        (capability) =>
          capability.id === filters.selected &&
          capability.status !== "disabled",
      )
    : undefined;
  const sourceGroups = partitionByCatalogSource(selected);

  return (
    <div className="agent-inventory-region">
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
      <div
        className={
          selectedCapability
            ? "agent-inventory-layout has-inspector"
            : "agent-inventory-layout"
        }
      >
        <aside className="agent-inventory-rail" aria-label="Inventory browsing">
          <nav className="agent-rail-section" aria-label="Agent provider">
            <div className="agent-rail-heading">Provider</div>
            {inventories.map((entry) => {
              const count = entry.capabilities.filter(
                (capability) => capability.status !== "disabled",
              ).length;
              return (
                <Link
                  key={entry.provider}
                  href={setupHref(filters, {
                    provider: entry.provider,
                    selected: undefined,
                  })}
                  className={
                    entry.provider === inventory.provider
                      ? "agent-provider-rail-item is-active"
                      : "agent-provider-rail-item"
                  }
                  aria-current={
                    entry.provider === inventory.provider ? "true" : undefined
                  }
                >
                  <span
                    className={`agent-provider-dot ${providerBadges[entry.provider]}`}
                    aria-hidden="true"
                  />
                  <span>{providerLabels[entry.provider]}</span>
                  <span className="agent-kind-rail-count">{count}</span>
                </Link>
              );
            })}
          </nav>
          <nav className="agent-rail-section" aria-label="Capability kind">
            <div className="agent-rail-heading">Kind</div>
            {RAIL_KINDS.map((kind) => (
              <KindRailItem
                key={kind}
                kind={kind}
                count={kindCounts[kind]}
                active={selectedKind === kind}
                href={setupHref(filters, {
                  kind,
                  selected: undefined,
                })}
              />
            ))}
            {hasInstruction ? (
              <KindRailItem
                kind="instruction"
                count={1}
                active={selectedKind === "instruction"}
                href={setupHref(filters, {
                  kind: "instruction",
                  selected: undefined,
                })}
              />
            ) : null}
          </nav>
        </aside>
        <section className="agent-catalog" aria-label="Capability catalog">
          <header className="agent-catalog-heading">
            <div>
              <strong>{kindLabels[selectedKind]}</strong>
              <span>{countLabel(selected.length, "item")}</span>
            </div>
            <span className={`badge ${providerBadges[inventory.provider]}`}>
              {providerLabels[inventory.provider]}
            </span>
          </header>
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
          ) : sourceGroups.length > 0 ? (
            <>
              <div className="agent-catalog-columns" aria-hidden="true">
                <span>Name</span>
                <span>Package / source</span>
                <span>Status</span>
                <span>Location / detail</span>
              </div>
              <div className="agent-capability-list">
                {sourceGroups.map((group) => (
                  <CatalogSourceGroup
                    key={group.source}
                    source={group.source}
                    capabilities={group.capabilities}
                    filters={filters}
                    duplicateNames={duplicateNames}
                    selectedId={selectedCapability?.id}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="agent-kind-empty">
              <strong>No capabilities match these filters.</strong>
              <p>Adjust the search, source, or status selection.</p>
            </div>
          )}
        </section>
        {selectedCapability ? (
          <CapabilityInspector
            capability={selectedCapability}
            inventory={inventory}
            filters={filters}
          />
        ) : null}
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

// Whether the instruction file survives the active status/search filters. Kind
// is deliberately not consulted: the rail owns that dimension, the same way
// `matchesCapability` ignores it for the other kinds.
function showsInstruction(
  inventory: AgentInventory,
  filters: AgentSetupFilters,
): boolean {
  if (!inventory.instructionFile) return false;
  if (filters.status) return false;
  if (!filters.q) return true;
  const query = filters.q.toLocaleLowerCase();
  return [
    inventory.instructionFile.filename,
    inventory.instructionFile.sourcePath,
  ].some((value) => value.toLocaleLowerCase().includes(query));
}

function partitionByCatalogSource(
  capabilities: AgentCapability[],
): { source: InventorySource; capabilities: AgentCapability[] }[] {
  const groups = new Map<InventorySource, AgentCapability[]>();
  for (const capability of capabilities) {
    const source = inventorySourceFor(capability);
    const members = groups.get(source) ?? [];
    members.push(capability);
    groups.set(source, members);
  }
  return inventorySources.flatMap((source) => {
    const members = groups.get(source);
    return members ? [{ source, capabilities: members }] : [];
  });
}

function catalogSourceTitle(
  source: InventorySource,
  capabilities: AgentCapability[],
): string {
  const label = inventorySourceMeta[source].label;
  const kind = capabilities[0]?.kind;
  return kind === "skill" ? `${label} skills` : label;
}

function catalogPackageSource(capability: AgentCapability): string {
  if (capability.sourcePlugin) return capability.sourcePlugin;
  if (capability.sourceRepository) return capability.sourceRepository;
  if (inventorySourceFor(capability) === "built_in") return "Agent runtime";
  if (inventorySourceFor(capability) === "personal") return "Personal install";
  return "Direct install";
}

function catalogLocationDetail(capability: AgentCapability): string {
  if (capability.sourcePath) return shortenHomePath(capability.sourcePath);
  const source = inventorySourceFor(capability);
  if (source === "plugin") return "Bundled with plugin";
  if (source === "built_in") return "Included with runtime";
  if (source === "marketplace") return "Managed install";
  return "Installed globally";
}

function CatalogSourceGroup({
  source,
  capabilities,
  filters,
  duplicateNames,
  selectedId,
}: {
  source: InventorySource;
  capabilities: AgentCapability[];
  filters: AgentSetupFilters;
  duplicateNames: Set<string>;
  selectedId?: string;
}) {
  const meta = inventorySourceMeta[source];
  const SourceIcon = meta.icon;
  const sorted = [...capabilities].sort(compareCatalogCapabilities);
  const shouldGroupPlugins =
    source === "plugin" && capabilities[0]?.kind === "skill";
  const pluginGroups = new Map<string, AgentCapability[]>();
  if (shouldGroupPlugins) {
    for (const capability of sorted) {
      const plugin = capability.sourcePlugin ?? "Plugin source unavailable";
      const members = pluginGroups.get(plugin) ?? [];
      members.push(capability);
      pluginGroups.set(plugin, members);
    }
  }

  return (
    <section className="agent-source-group">
      <header className="agent-source-group-heading">
        <div>
          <SourceIcon aria-hidden="true" size={15} />
          <strong>{catalogSourceTitle(source, capabilities)}</strong>
          <span>{meta.description}</span>
        </div>
        <span>{countLabel(capabilities.length, "item")}</span>
      </header>
      <div className="agent-source-group-body">
        {shouldGroupPlugins
          ? [...pluginGroups.entries()].map(([plugin, members]) => (
              <PluginSkillGroup
                key={plugin}
                plugin={plugin}
                members={members}
                filters={filters}
                duplicateNames={duplicateNames}
                selectedId={selectedId}
              />
            ))
          : sorted.map((capability) => (
              <CatalogCapabilityRow
                key={capability.id}
                capability={capability}
                filters={filters}
                duplicateNames={duplicateNames}
                selected={selectedId === capability.id}
              />
            ))}
      </div>
    </section>
  );
}

function pluginGroupStatus(members: AgentCapability[]): CapabilityStatus {
  if (members.some((capability) => capability.status === "unavailable")) {
    return "unavailable";
  }
  return members.every((capability) => capability.status === "enabled")
    ? "enabled"
    : "installed";
}

function PluginSkillGroup({
  plugin,
  members,
  filters,
  duplicateNames,
  selectedId,
}: {
  plugin: string;
  members: AgentCapability[];
  filters: AgentSetupFilters;
  duplicateNames: Set<string>;
  selectedId?: string;
}) {
  const status = pluginGroupStatus(members);
  const source = members[0]?.sourceRepository ?? "Plugin package";
  return (
    <details className="agent-plugin-group">
      <summary className="agent-catalog-grid">
        <span className="agent-plugin-group-name">
          <span>
            <strong>{plugin}</strong>
          </span>
        </span>
        <span className="agent-catalog-source">{source}</span>
        <span>
          <span className={`badge ${statusBadges[status]}`}>
            {statusLabels[status]}
          </span>
        </span>
        <span className="agent-catalog-detail">
          {countLabel(members.length, "skill")}
        </span>
      </summary>
      <div className="agent-plugin-group-members">
        {members.map((capability) => (
          <CatalogCapabilityRow
            key={capability.id}
            capability={capability}
            filters={filters}
            duplicateNames={duplicateNames}
            selected={selectedId === capability.id}
            withinPlugin
          />
        ))}
      </div>
    </details>
  );
}

function CatalogCapabilityRow({
  capability,
  filters,
  duplicateNames,
  selected,
  withinPlugin,
}: {
  capability: AgentCapability;
  filters: AgentSetupFilters;
  duplicateNames: Set<string>;
  selected: boolean;
  withinPlugin?: boolean;
}) {
  const source = inventorySourceFor(capability);
  const sourceLabel = inventorySourceMeta[source].label;
  return (
    <Link
      href={setupHref(filters, { selected: capability.id })}
      prefetch={false}
      className={
        withinPlugin
          ? "agent-catalog-row agent-catalog-grid agent-catalog-row-child"
          : "agent-catalog-row agent-catalog-grid"
      }
      aria-current={selected ? "true" : undefined}
    >
      <span className="agent-catalog-name">
        <strong>{capability.name}</strong>
        <span className="agent-row-source">{sourceLabel}</span>
      </span>
      <span className="agent-catalog-source">
        {catalogPackageSource(capability)}
      </span>
      <span>
        <span className={`badge ${statusBadges[capability.status]}`}>
          {statusLabels[capability.status]}
        </span>
      </span>
      <span className="agent-catalog-detail">
        {capability.sourcePath ? (
          <code>{catalogLocationDetail(capability)}</code>
        ) : (
          catalogLocationDetail(capability)
        )}
        {duplicateNames.has(capability.name) ? (
          <span className="agent-duplicate-inline">Duplicate install</span>
        ) : null}
      </span>
    </Link>
  );
}

function CapabilityInspector({
  capability,
  inventory,
  filters,
}: {
  capability: AgentCapability;
  inventory: AgentInventory;
  filters: AgentSetupFilters;
}) {
  const KindIcon = kindIcons[capability.kind];
  const source = inventorySourceFor(capability);
  const duplicate = findComparisonDuplicates([inventory]).find(
    (entry) => entry.kind === capability.kind && entry.name === capability.name,
  );
  return (
    <aside className="agent-catalog-inspector" aria-label="Selected capability">
      <header className="agent-inspector-heading">
        <div>
          <KindIcon aria-hidden="true" size={16} />
          <div>
            <strong>{capability.name}</strong>
            <span>{capabilityKindLabels[capability.kind]}</span>
          </div>
        </div>
        <Link
          href={setupHref(filters, { selected: undefined })}
          className="agent-inspector-close"
          aria-label="Close inspector"
        >
          <X aria-hidden="true" size={15} />
        </Link>
      </header>
      <dl className="agent-inspector-details">
        <div>
          <dt>Provider</dt>
          <dd>{providerLabels[inventory.provider]}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{inventorySourceMeta[source].label}</dd>
        </div>
        {capability.sourcePlugin ? (
          <div>
            <dt>Parent plugin</dt>
            <dd>{capability.sourcePlugin}</dd>
          </div>
        ) : null}
        <div>
          <dt>Package / source</dt>
          <dd>{catalogPackageSource(capability)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{statusLabels[capability.status]}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>
            <code>{catalogLocationDetail(capability)}</code>
          </dd>
        </div>
      </dl>
      {duplicate ? (
        <section className="agent-inspector-duplicates">
          <header>
            <strong>Duplicate installs</strong>
            <span>{countLabel(duplicate.copies.length, "location")}</span>
          </header>
          <p>
            {duplicate.identicalContent
              ? "Copies have matching content."
              : "Copies may differ; review which install should take precedence."}
          </p>
          <div>
            {duplicate.copies.map((copy) =>
              copy.sourcePath ? (
                <code key={copy.id}>{shortenHomePath(copy.sourcePath)}</code>
              ) : null,
            )}
          </div>
        </section>
      ) : null}
    </aside>
  );
}

function filteredComparisonRows(
  inventories: AgentInventory[],
  filters: AgentSetupFilters,
): ComparisonRow[] {
  let rows = buildComparisonRows(inventories);
  if (filters.q) {
    const query = filters.q.toLocaleLowerCase();
    rows = rows.filter((row) => row.name.toLocaleLowerCase().includes(query));
  }
  if (filters.kind) rows = rows.filter((row) => row.kind === filters.kind);
  if (filters.status) {
    rows = rows.filter((row) =>
      Object.values(row.cells).some(
        (capability) => capability.status === filters.status,
      ),
    );
  }
  return rows;
}

function ComparisonView({
  inventories,
  filters,
}: {
  inventories: AgentInventory[];
  filters: AgentSetupFilters;
}) {
  let rows = filteredComparisonRows(inventories, filters);
  // No provider narrowing here — see FilterForm: Compare always spans every
  // provider so drift stays visible.
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

  const duplicates =
    filters.comparisonMode === "attention"
      ? findComparisonDuplicates(inventories)
      : [];
  // Warnings mean the inventory itself may be incomplete (malformed config,
  // stale artifacts) — the highest-severity condition the discovery layer can
  // report, so the attention view leads with them. Shared-source warnings
  // (e.g. the skills.sh lockfile) repeat on every provider; dedupe by content.
  const attentionWarnings =
    filters.comparisonMode === "attention"
      ? [
          ...new Map(
            inventories
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
                      className={
                        capability.status === "enabled" ||
                        capability.status === "installed"
                          ? `agent-status-tag agent-status-tag--chip ${statusBadges[capability.status]}`
                          : `agent-status-tag--bare agent-status-tag--${capability.status}`
                      }
                      title={statusLabels[capability.status]}
                      aria-label={statusLabels[capability.status]}
                    >
                      <StatusIcon size={13} />
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
                <span
                  className="agent-missing agent-status-tag--bare"
                  title="Missing"
                  aria-label="Missing"
                >
                  <Minus size={13} />
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

function scheduledTasksFor(inventories: AgentInventory[]): ScheduledTask[] {
  return inventories
    .flatMap((inventory) => inventory.scheduledTasks ?? [])
    .sort(compareScheduledTasks);
}

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
  const tasks = scheduledTasksFor(inventories);
  const total = tasks.length;
  return (
    <div className="agent-inventory-list">
      {total === 0 ? (
        <div className="card empty-state agent-empty-state">
          <h3>No scheduled tasks found across agents.</h3>
        </div>
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
  const project = task.targetProjectName ?? task.targetProject;
  return (
    <details name="agent-tasks" className="agent-task-row">
      <summary className="agent-task-summary">
        <span className="agent-task-sched">
          {schedule ?? "Schedule unavailable"}
        </span>
        {/* Name and flag share one grid cell so the badge columns stay aligned. */}
        <span className="agent-task-title">
          <strong className="agent-task-name">{task.name}</strong>
          {task.warnings.some((item) => item.code === "orphaned") ? (
            <span className="agent-task-flag">Target missing</span>
          ) : null}
        </span>
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
          {project ? (
            <span>
              Project: <code>{project}</code>
            </span>
          ) : null}
          <span>
            Source: <code>{shortenHomePath(task.sourcePath)}</code>
          </span>
        </div>
        {task.warnings.map((item) => (
          <div className="notice" key={`${item.code}:${item.message}`}>
            <AlertTriangle size={14} aria-hidden="true" />
            <span>{item.message}</span>
          </div>
        ))}
        {task.instructionBody ? (
          <pre className="agent-task-instruction">{task.instructionBody}</pre>
        ) : null}
      </div>
    </details>
  );
}
