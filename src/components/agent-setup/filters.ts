import type {
  AgentCapability,
  CapabilityKind,
  CapabilityStatus,
} from "@/lib/agent-inventory";
import { firstParam } from "@/lib/queries";
import { agentProviders, type AgentProvider } from "@/lib/types";

export type AgentSetupViewMode = "inventory" | "compare" | "tasks";
export type AgentSetupKind = CapabilityKind | "instruction";

export interface AgentSetupFilters {
  view: AgentSetupViewMode;
  comparisonMode?: "attention";
  q?: string;
  provider?: AgentProvider;
  kind?: AgentSetupKind;
  status?: CapabilityStatus;
  selected?: string;
  discrepanciesOnly?: boolean;
}

export function parseAgentSetupFilters(
  params: Record<string, string | string[] | undefined>,
): AgentSetupFilters {
  const provider = firstParam(params.provider);
  const kind = firstParam(params.kind);
  const status = firstParam(params.status);
  const view =
    firstParam(params.view) === "compare"
      ? "compare"
      : firstParam(params.view) === "tasks"
        ? "tasks"
        : "inventory";
  // Compare spans every provider by design, so a provider param is meaningless
  // there. Drop it at the boundary rather than letting it leak into the summary
  // cards and tab links as a selection that filters nothing.
  const scopedProvider = view === "compare" ? undefined : provider;
  return {
    view,
    comparisonMode:
      firstParam(params.comparison) === "attention" ? "attention" : undefined,
    q: firstParam(params.q)?.trim() || undefined,
    provider: agentProviders.includes(scopedProvider as AgentProvider)
      ? (scopedProvider as AgentProvider)
      : undefined,
    kind: ["plugin", "skill", "mcp", "instruction"].includes(kind ?? "")
      ? (kind as AgentSetupKind)
      : undefined,
    // Status is a Compare-only control, so it is scoped here the same way
    // provider is: an inventory URL carrying one would filter a list that
    // offers no way to clear it.
    status:
      view === "compare" &&
      ["enabled", "installed", "disabled", "unavailable"].includes(status ?? "")
        ? (status as CapabilityStatus)
        : undefined,
    selected: view === "inventory" ? firstParam(params.selected) : undefined,
    discrepanciesOnly: firstParam(params.discrepancies) === "1" || undefined,
  };
}

export function setupHref(
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
  if (next.view === "compare" && next.status) {
    params.set("status", next.status);
  }
  if (next.view === "inventory" && next.selected) {
    params.set("selected", next.selected);
  }
  if (next.discrepanciesOnly) params.set("discrepancies", "1");
  const query = params.toString();
  return query ? `/agents?${query}` : "/agents";
}

export function matchesCapability(
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
  if (!filters.q) return true;
  const query = filters.q.toLocaleLowerCase();
  return [
    capability.name,
    capability.sourcePlugin,
    capability.sourceRepository,
    capability.sourcePath,
  ].some((value) => value?.toLocaleLowerCase().includes(query));
}
