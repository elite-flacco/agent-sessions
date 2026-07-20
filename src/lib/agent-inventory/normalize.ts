import { agentProviders, type AgentProvider } from "@/lib/types";
import { providerLabels } from "@/lib/labels";
import type {
  AgentCapability,
  AgentInventory,
  CapabilityOrigin,
  ComparisonAssessment,
  ComparisonDuplicate,
  ComparisonRow,
} from "./types";

/**
 * Assessment (fix/review) is driven by the three primary coding agents. Pi is a
 * secondary agent whose presence, absence, or configuration differences must not
 * surface as fixes or reviews — it still renders in the matrix for visibility.
 */
const primaryProviders: readonly AgentProvider[] = ["codex", "claude", "zcode"];

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

// Raw per-provider signature used only to decide whether the Complete matrix
// can collapse a row into a single all-agent cell — the collapsed cell shows
// one status/packaging/origin, so it must only appear when they are literally
// identical everywhere.
function comparisonSignature(capability: AgentCapability): string {
  return [capability.status, capability.packaging, capability.origin].join(":");
}

/**
 * Signature used for drift assessment and discrepancy highlighting.
 * `sourceRepository` is deliberately excluded: it reflects how each provider
 * discovered/packaged the capability, not anything the user controls.
 * "enabled" and "installed" both mean "active" — the split is structural
 * (plugin-contributed capabilities inherit "enabled", standalone ones read
 * "installed") and must not read as drift. For skills, packaging is likewise
 * structural noise, and the content fingerprint takes its place: two skills
 * that share a name but differ in SKILL.md content are the drift that
 * actually changes agent behavior.
 */
function assessmentSignature(capability: AgentCapability): string {
  const status =
    capability.status === "enabled" || capability.status === "installed"
      ? "active"
      : capability.status;
  return capability.kind === "skill"
    ? [status, capability.origin, capability.contentFingerprint ?? ""].join(":")
    : [status, capability.packaging, capability.origin].join(":");
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
  const present = primaryProviders.filter((provider) => row.cells[provider]);
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

  if (present.length === 2) {
    const missing = primaryProviders.filter((provider) => !row.cells[provider]);
    // skills.sh installs exist to be synced across agents, so a gap there is
    // a genuine fix. For everything else (personal MCPs, marketplace plugins)
    // partial presence is often deliberate — flag for review, not repair.
    const crossAgentIntent = present.some(
      (provider) => row.cells[provider]?.origin === "skills_sh",
    );
    return {
      level: crossAgentIntent ? "fix" : "review",
      reason: "missing_from_one_provider",
      message: `Present on 2 of 3 agents; missing from ${formatProviderList(missing)}.`,
    };
  }

  if (present.length <= 1) {
    return present.length === 1
      ? {
          level: "context",
          reason: "provider_specific",
          message: `Only found on ${formatProviderList(present)}.`,
        }
      : {
          level: "context",
          reason: "provider_specific",
          message: "Not found on any primary agent.",
        };
  }

  const signatures = new Set(
    present.map((provider) => assessmentSignature(row.cells[provider]!)),
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
  const missing = primaryProviders.filter(
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
    primaryProviders.map(
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

    // Discrepancy highlighting tracks the primary agents only — Pi's absence
    // or configuration must not mark a row that the three primaries agree on.
    const primarySignatures = primaryProviders.map((provider) => {
      const capability = row.cells[provider];
      return capability ? assessmentSignature(capability) : undefined;
    });
    row.isDiscrepancy = new Set(primarySignatures).size > 1;
    row.assessment = assessCapabilityRow(row);
    // The collapsed all-agent cell renders one literal status/packaging/origin,
    // so uniformity is judged on the raw signature across all four providers.
    const rawSignatures = agentProviders.map((provider) => {
      const capability = row.cells[provider];
      return capability ? comparisonSignature(capability) : undefined;
    });
    row.isUniformAcrossProviders =
      rawSignatures.every((signature) => signature !== undefined) &&
      new Set(rawSignatures).size === 1;
  }

  return [...rows.values()].sort((left, right) => {
    if (left.kind === "instruction") return 1;
    if (right.kind === "instruction") return -1;
    const kind = left.kind.localeCompare(right.kind);
    return kind || left.name.localeCompare(right.name);
  });
}

/**
 * Find same-name, same-kind capabilities that appear more than once in a
 * single provider's inventory via distinct install paths. These are genuine
 * on-disk duplicates (e.g. skills.sh cloned a skill AND a plugin cache
 * independently pulled a copy) that the path-based dedupe cannot collapse.
 * Surfaced in the Compare view's Needs Attention mode so the user can spot
 * and clean them up. Cross-provider duplicates are NOT flagged here — only
 * multiple copies within one provider.
 */
export function findComparisonDuplicates(
  inventories: AgentInventory[],
): ComparisonDuplicate[] {
  const duplicates: ComparisonDuplicate[] = [];
  for (const inventory of inventories) {
    const byKey = new Map<string, AgentCapability[]>();
    for (const capability of inventory.capabilities) {
      // Disabled and unavailable copies are not in effect, so they cannot
      // conflict with the active copy — only active duplicates matter here.
      if (
        capability.status !== "enabled" &&
        capability.status !== "installed"
      ) {
        continue;
      }
      const key = `${capability.kind}:${canonicalCapabilityName(capability.name)}`;
      const arr = byKey.get(key) ?? [];
      arr.push(capability);
      byKey.set(key, arr);
    }
    for (const [, copies] of byKey) {
      if (copies.length < 2) continue;
      const fingerprints = new Set(
        copies.map((copy) => copy.contentFingerprint),
      );
      duplicates.push({
        provider: inventory.provider,
        name: copies[0]!.name,
        kind: copies[0]!.kind,
        copies,
        identicalContent:
          fingerprints.size === 1 && !fingerprints.has(undefined),
      });
    }
  }
  return duplicates.sort((left, right) => {
    const provider = left.provider.localeCompare(right.provider);
    if (provider) return provider;
    const kind = left.kind.localeCompare(right.kind);
    return kind || left.name.localeCompare(right.name);
  });
}
