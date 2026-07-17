import { agentProviders } from "@/lib/types";
import { providerLabels } from "@/lib/labels";
import type {
  AgentCapability,
  AgentInventory,
  CapabilityOrigin,
  ComparisonAssessment,
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

function formatProviderList(
  providers: (typeof agentProviders)[number][],
): string {
  const labels = providers.map((provider) => providerLabels[provider]);
  if (labels.length <= 1) return labels[0] ?? "an agent";
  if (labels.length === 2) return labels.join(" and ");
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

function assessCapabilityRow(row: ComparisonRow): ComparisonAssessment {
  const present = agentProviders.filter((provider) => row.cells[provider]);
  const unavailable = present.filter(
    (provider) => row.cells[provider]?.status === "unavailable",
  );

  if (unavailable.length > 0) {
    return {
      level: "fix",
      reason: "unavailable",
      message: `Unavailable on ${formatProviderList(unavailable)}.`,
    };
  }

  if (present.length === 3) {
    const missing = agentProviders.filter((provider) => !row.cells[provider]);
    return {
      level: "fix",
      reason: "missing_from_one_provider",
      message: `Present on 3 of 4 agents; missing from ${formatProviderList(missing)}.`,
    };
  }

  if (present.length === 2) {
    return {
      level: "review",
      reason: "split_presence",
      message: "Present on 2 of 4 agents; review whether parity is intended.",
    };
  }

  if (present.length === 1) {
    return {
      level: "context",
      reason: "provider_specific",
      message: `Only found on ${formatProviderList(present)}.`,
    };
  }

  const signatures = new Set(
    present.map((provider) => comparisonSignature(row.cells[provider]!)),
  );
  return signatures.size > 1
    ? {
        level: "review",
        reason: "configuration_drift",
        message: "Installed across all agents with differing configuration.",
      }
    : {
        level: "context",
        reason: "consistent",
        message: "Consistent across all agents.",
      };
}

function assessInstructionRow(row: ComparisonRow): ComparisonAssessment {
  const missing = agentProviders.filter(
    (provider) => !row.instructionCells?.[provider],
  );
  if (missing.length > 0) {
    return {
      level: "fix",
      reason: "missing_instruction",
      message: `Global instructions missing from ${formatProviderList(missing)}.`,
    };
  }

  const fingerprints = new Set(
    agentProviders.map(
      (provider) => row.instructionCells![provider]!.contentFingerprint,
    ),
  );
  return fingerprints.size > 1
    ? {
        level: "review",
        reason: "instruction_drift",
        message: "Global instruction contents differ across agents.",
      }
    : {
        level: "context",
        reason: "consistent",
        message: "Consistent across all agents.",
      };
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
        assessment: {
          level: "context",
          reason: "consistent",
          message: "Consistent across all agents.",
        },
        isUniformAcrossProviders: false,
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
      assessment: {
        level: "context",
        reason: "consistent",
        message: "Consistent across all agents.",
      },
      isUniformAcrossProviders: false,
    });
  }

  for (const row of rows.values()) {
    if (row.kind === "instruction") {
      const fingerprints = agentProviders.map(
        (provider) => row.instructionCells?.[provider]?.contentFingerprint,
      );
      row.isDiscrepancy = new Set(fingerprints).size > 1;
      row.assessment = assessInstructionRow(row);
      continue;
    }

    const signatures = agentProviders.map((provider) => {
      const capability = row.cells[provider];
      return capability ? comparisonSignature(capability) : undefined;
    });
    row.isDiscrepancy = new Set(signatures).size > 1;
    row.assessment = assessCapabilityRow(row);
    row.isUniformAcrossProviders =
      signatures.every((signature) => signature !== undefined) &&
      new Set(signatures).size === 1;
  }

  return [...rows.values()].sort((left, right) => {
    if (left.kind === "instruction") return 1;
    if (right.kind === "instruction") return -1;
    const kind = left.kind.localeCompare(right.kind);
    return kind || left.name.localeCompare(right.name);
  });
}
