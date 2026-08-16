import { Search } from "lucide-react";
import Link from "next/link";
import type { AgentInventory } from "@/lib/agent-inventory";
import { AgentFilterForm } from "../agent-filter-form";
import { AgentSetupContextSummary } from "./context-summary";
import type { AgentSetupFilters } from "./filters";
import { setupHref } from "./filters";
import { ComparisonView } from "./comparison-view";
import { InventoryView } from "./inventory-view";
import { kindLabels, statusLabels } from "./meta";
import { ScheduledTasksView } from "./tasks-view";

interface AgentSetupViewProps {
  inventories: AgentInventory[];
  filters: AgentSetupFilters;
}

export function AgentSetupView({ inventories, filters }: AgentSetupViewProps) {
  return (
    <section className="relay-content min-w-0">
      <header className="page-header">
        <div>
          <h1>Agent setup</h1>
          <p>
            Live global inventory for installed plugins, skills, MCPs, and
            instruction files
          </p>
        </div>
      </header>

      <nav className="workspace-switcher" aria-label="Agent setup view">
        <Link
          href={setupHref(filters, {
            view: "inventory",
            comparisonMode: undefined,
            discrepanciesOnly: undefined,
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
        // Status stays here and nowhere else: Inventory groups by source and
        // flags the one exceptional status inline, so the only question a
        // status control still answers — which providers a capability is
        // broken or disabled on — is a cross-provider one.
        <>
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
          <label className="agent-filter">
            <span className="sr-only">Status</span>
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
        </>
      ) : (
        <>
          {/* Inventory selects provider and kind in the rail; preserve both so
              a search keeps the current view. */}
          {filters.provider ? (
            <input type="hidden" name="provider" value={filters.provider} />
          ) : null}
          {filters.kind ? (
            <input type="hidden" name="kind" value={filters.kind} />
          ) : null}
        </>
      )}
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
