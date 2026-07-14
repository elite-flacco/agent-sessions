import { AlertTriangle, Check, Minus, Search } from "lucide-react";
import Link from "next/link";
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

const statusLabels: Record<CapabilityStatus, string> = {
  enabled: "Enabled",
  disabled: "Disabled",
  installed: "Installed",
  unavailable: "Unavailable",
};

const originLabels: Record<AgentCapability["origin"], string> = {
  personal: "Personal/local",
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

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
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
          href={setupHref(filters, { view: "compare" })}
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
    <form className="agent-filter-row" action="/agents" method="get">
      {filters.view === "compare" ? (
        <input type="hidden" name="view" value="compare" />
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
      {filters.view === "compare" ? (
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
      <button className="btn btn-outline" type="submit">
        Apply filters
      </button>
    </form>
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
  const capabilities = inventory.capabilities.filter((capability) =>
    matchesCapability(capability, filters),
  );
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
            <strong>{inventory.instructionFile.filename}</strong>
            <span>{inventory.instructionFile.sourcePath}</span>
          </summary>
          <pre>{inventory.instructionFile.content}</pre>
        </details>
      ) : null}
    </section>
  );
}

function CapabilityRow({ capability }: { capability: AgentCapability }) {
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
      <span className="badge badge-5">{capability.kind.toUpperCase()}</span>
      <span className={`badge ${originBadges[capability.origin]}`}>
        {originLabels[capability.origin]}
      </span>
      <span className="agent-packaging">
        {capability.packaging.replace("_", " ")}
      </span>
      <span className={`status-label status-${capability.status}`}>
        <i /> {statusLabels[capability.status]}
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
  if (filters.discrepanciesOnly) {
    rows = rows.filter((row) => row.isDiscrepancy);
  }

  if (rows.length === 0) {
    return (
      <div className="card empty-state agent-empty-state">
        <h3>No comparison rows match these filters.</h3>
        <p>Adjust the filters or include matching configurations.</p>
      </div>
    );
  }

  return (
    <div className="card agent-comparison-region" tabIndex={0}>
      <table className="agent-comparison-table">
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
        <tbody>
          {rows.map((row) => (
            <ComparisonTableRow key={row.key} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ComparisonTableRow({ row }: { row: ComparisonRow }) {
  return (
    <tr className={row.isDiscrepancy ? "agent-row-discrepancy" : undefined}>
      <th scope="row">
        <strong>{row.name}</strong>
        <span>{row.kind}</span>
      </th>
      {agentProviders.map((provider) => {
        const instruction = row.instructionCells?.[provider];
        const capability = row.cells[provider];
        return (
          <td key={provider}>
            {instruction ? (
              <details className="agent-compare-detail">
                <summary>
                  <Check size={13} /> {instruction.filename}
                </summary>
                <code>{instruction.sourcePath}</code>
                <pre>{instruction.content}</pre>
              </details>
            ) : capability ? (
              <details className="agent-compare-detail">
                <summary>
                  <Check size={13} /> {statusLabels[capability.status]}
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
              <span className="agent-missing">
                <Minus size={13} /> Missing
              </span>
            )}
          </td>
        );
      })}
    </tr>
  );
}
