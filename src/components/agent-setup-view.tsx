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
  type AgentCapability,
  type AgentInventory,
  type CapabilityKind,
  type CapabilityStatus,
  type ComparisonRow,
} from "@/lib/agent-inventory";
import { providerBadges, providerLabels } from "@/lib/labels";
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
    status: ["enabled", "disabled", "installed", "unavailable"].includes(
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

function compareInventoryCapabilities(
  left: AgentCapability,
  right: AgentCapability,
): number {
  return (
    kindSortOrder[left.kind] - kindSortOrder[right.kind] ||
    originLabels[left.origin].localeCompare(originLabels[right.origin]) ||
    left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id)
  );
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
      {capabilities.length > 0 ? (
        <div className="agent-capability-list">
          {capabilities.map((capability) => (
            <CapabilityRow key={capability.id} capability={capability} />
          ))}
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

function CapabilityRow({ capability }: { capability: AgentCapability }) {
  const KindIcon = kindIcons[capability.kind];
  const StatusIcon =
    capability.status === "disabled"
      ? CircleSlash2
      : capability.status === "unavailable"
        ? CircleX
        : Check;

  return (
    <div className="agent-capability-row">
      <div className="agent-capability-primary">
        <strong>{capability.name}</strong>
        <span>
          {capability.sourceRepository ??
            capability.sourcePlugin ??
            capability.sourcePath}
        </span>
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
    </>
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
                <details className="agent-compare-detail">
                  <summary
                    className={`agent-status-tag ${statusBadges[capability.status]}`}
                  >
                    <StatusIcon size={13} /> {statusLabels[capability.status]}
                  </summary>
                  <span>{originLabels[capability.origin]}</span>
                  <span>{capability.packaging.replace("_", " ")}</span>
                  {capability.sourceRepository ? (
                    <code>{capability.sourceRepository}</code>
                  ) : null}
                  {capability.sourcePath ? (
                    <code>{capability.sourcePath}</code>
                  ) : null}
                </details>
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
        {capability.sourceRepository ? (
          <code>{capability.sourceRepository}</code>
        ) : null}
      </details>
    </td>
  );
}
