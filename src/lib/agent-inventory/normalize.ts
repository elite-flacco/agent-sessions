import { agentProviders } from "@/lib/types";
import type {
  AgentCapability,
  AgentInventory,
  CapabilityOrigin,
  ComparisonRow,
} from "./types";

const provenancePriority: Record<CapabilityOrigin, number> = {
  unknown: 0,
  marketplace: 1,
  skills_sh: 2,
  personal: 3,
  built_in: 4,
};

export function canonicalCapabilityName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function dedupeKey(capability: AgentCapability): string {
  const source =
    capability.canonicalSourcePath ??
    capability.sourcePath ??
    canonicalCapabilityName(capability.name);
  return `${capability.kind}:${source}`;
}

function compareCapabilities(
  left: AgentCapability,
  right: AgentCapability,
): number {
  const name = left.name.localeCompare(right.name);
  if (name !== 0) return name;
  return left.id.localeCompare(right.id);
}

export function dedupeCapabilities(
  capabilities: AgentCapability[],
): AgentCapability[] {
  const bySource = new Map<string, AgentCapability>();

  for (const capability of capabilities) {
    const key = dedupeKey(capability);
    const current = bySource.get(key);
    if (
      !current ||
      provenancePriority[capability.origin] > provenancePriority[current.origin]
    ) {
      bySource.set(key, capability);
    }
  }

  return [...bySource.values()].sort(compareCapabilities);
}

function comparisonSignature(capability: AgentCapability): string {
  return [
    capability.status,
    capability.packaging,
    capability.origin,
    capability.sourceRepository ?? "",
  ].join(":");
}

export function buildComparisonRows(
  inventories: AgentInventory[],
): ComparisonRow[] {
  const rows = new Map<string, ComparisonRow>();

  for (const inventory of inventories) {
    for (const capability of inventory.capabilities) {
      const canonicalName = canonicalCapabilityName(capability.name);
      const key = `${capability.kind}:${canonicalName}`;
      const row = rows.get(key) ?? {
        key,
        name: capability.name,
        kind: capability.kind,
        cells: {},
        isDiscrepancy: false,
      };
      row.cells[inventory.provider] = capability;
      rows.set(key, row);
    }
  }

  const instructionCells: NonNullable<ComparisonRow["instructionCells"]> = {};
  for (const inventory of inventories) {
    if (inventory.instructionFile) {
      instructionCells[inventory.provider] = inventory.instructionFile;
    }
  }
  if (Object.keys(instructionCells).length > 0) {
    rows.set("instruction:global", {
      key: "instruction:global",
      name: "Global instructions",
      kind: "instruction",
      cells: {},
      instructionCells,
      isDiscrepancy: false,
    });
  }

  for (const row of rows.values()) {
    if (row.kind === "instruction") {
      const fingerprints = agentProviders.map(
        (provider) => row.instructionCells?.[provider]?.contentFingerprint,
      );
      row.isDiscrepancy = new Set(fingerprints).size > 1;
      continue;
    }

    const signatures = agentProviders.map((provider) => {
      const capability = row.cells[provider];
      return capability ? comparisonSignature(capability) : undefined;
    });
    row.isDiscrepancy = new Set(signatures).size > 1;
  }

  return [...rows.values()].sort((left, right) => {
    if (left.kind === "instruction") return 1;
    if (right.kind === "instruction") return -1;
    const kind = left.kind.localeCompare(right.kind);
    return kind || left.name.localeCompare(right.name);
  });
}
