import {
  Boxes,
  FileText,
  PackageOpen,
  Plug,
  UserRound,
  WandSparkles,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import type { AgentCapability, CapabilityStatus } from "@/lib/agent-inventory";
import type { AgentSetupKind } from "./filters";

export type InventorySource =
  "standalone" | "plugin" | "built_in" | "marketplace" | "personal";

export const kindLabels: Record<AgentSetupKind, string> = {
  plugin: "Plugins",
  skill: "Skills",
  mcp: "MCPs",
  instruction: "Instructions",
};

export const capabilityKindLabels: Record<AgentSetupKind, string> = {
  plugin: "Plugin",
  skill: "Skill",
  mcp: "MCP",
  instruction: "Instruction",
};

export const kindMarkers: Record<AgentSetupKind, string> = {
  plugin: "agent-kind-plugin",
  skill: "agent-kind-skill",
  mcp: "agent-kind-mcp",
  instruction: "agent-kind-instruction",
};

export const kindIcons: Record<AgentSetupKind, LucideIcon> = {
  plugin: Plug,
  skill: WandSparkles,
  mcp: Waypoints,
  instruction: FileText,
};

export const statusLabels: Record<CapabilityStatus, string> = {
  enabled: "Enabled",
  disabled: "Disabled",
  installed: "Installed",
  unavailable: "Unavailable",
};

/**
 * Status chips draw from the status ramp, not the numbered badge palette, so
 * "Enabled" can no longer wear the same colour as a provider badge sitting in
 * the next column. The enabled/disabled grouping is unchanged.
 */
export const statusBadges: Record<CapabilityStatus, string> = {
  enabled: "badge-status-ok",
  installed: "badge-status-ok",
  disabled: "badge-status-warn",
  unavailable: "badge-status-warn",
};

/**
 * Inventory ordering for origins. Mostly alphabetical by label, except
 * skills.sh sorts above Personal so managed installs read before local links.
 */
export const originLabels: Record<AgentCapability["origin"], string> = {
  personal: "Personal",
  skills_sh: "skills.sh",
  marketplace: "Marketplace",
  built_in: "Built in",
  unknown: "Unknown",
};

export const inventorySources: InventorySource[] = [
  "standalone",
  "plugin",
  "built_in",
  "marketplace",
  "personal",
];

export const inventorySourceMeta: Record<
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

/**
 * The always-visible "source" line for a comparison cell: the contributing
 * plugin name for plugin-packaged capabilities, otherwise the skills.sh
 * repository for skills.sh-installed standalone skills. Personal, built_in, and
 * unknown-origin capabilities have no useful source identifier and render no
 * line; their origin is still shown inside the expanded details body.
 */
export function capabilitySourceLabel(
  capability: AgentCapability,
): string | undefined {
  if (capability.sourcePlugin) return capability.sourcePlugin;
  if (capability.origin === "skills_sh" && capability.sourceRepository) {
    return capability.sourceRepository;
  }
  return undefined;
}

export function inventorySourceFor(
  capability: AgentCapability,
): InventorySource {
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

export function compareCatalogCapabilities(
  left: AgentCapability,
  right: AgentCapability,
): number {
  return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}
