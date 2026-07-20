import type { AgentProvider } from "@/lib/types";

export type InventoryScope = { kind: "global" };
export type CapabilityKind = "plugin" | "skill" | "mcp";
export type CapabilityStatus =
  "enabled" | "disabled" | "installed" | "unavailable";
export type CapabilityPackaging = "standalone" | "plugin" | "built_in";
export type CapabilityOrigin =
  "personal" | "skills_sh" | "marketplace" | "built_in" | "unknown";

export interface AgentCapability {
  id: string;
  name: string;
  kind: CapabilityKind;
  status: CapabilityStatus;
  packaging: CapabilityPackaging;
  origin: CapabilityOrigin;
  sourcePlugin?: string;
  sourceRepository?: string;
  sourcePath?: string;
  canonicalSourcePath?: string;
  /**
   * Whitespace-normalized SHA-256 of the skill's SKILL.md body. Lets the
   * comparison detect skills that share a name but carry different content
   * across providers (the drift that actually changes agent behavior).
   */
  contentFingerprint?: string;
}

export interface InstructionFile {
  filename: string;
  sourcePath: string;
  content: string;
  contentFingerprint: string;
}

export interface InventoryWarning {
  sourcePath: string;
  code: "unreadable" | "malformed" | "unsupported" | "stale";
  message: string;
}

export interface AgentInventory {
  provider: AgentProvider;
  scope: "global";
  capabilities: AgentCapability[];
  instructionFile?: InstructionFile;
  warnings: InventoryWarning[];
}

export type ComparisonAssessmentLevel = "fix" | "review" | "context";

export type ComparisonAssessmentReason =
  | "unavailable"
  | "missing_instruction"
  | "missing_from_one_provider"
  | "split_presence"
  | "configuration_drift"
  | "instruction_drift"
  | "provider_specific"
  | "consistent";

export interface ComparisonAssessment {
  level: ComparisonAssessmentLevel;
  reason: ComparisonAssessmentReason;
  message: string;
}

export interface ComparisonRow {
  key: string;
  name: string;
  kind: CapabilityKind | "instruction";
  cells: Partial<Record<AgentProvider, AgentCapability>>;
  instructionCells?: Partial<Record<AgentProvider, InstructionFile>>;
  isDiscrepancy: boolean;
  assessment: ComparisonAssessment;
  isUniformAcrossProviders: boolean;
}

/**
 * A same-name capability installed more than once in a single provider's
 * inventory via different physical paths (e.g. skills.sh cloned ai-sdk into
 * ~/.agents/skills/ai-sdk and the Codex plugin cache independently pulled a
 * copy via the openai-curated marketplace). Surfaced in the Compare view's
 * Needs Attention mode under a "Duplicates" section so the user can spot
 * and clean up redundant installs that the path-based dedupe cannot collapse
 * (the copies are genuinely different files on disk).
 */
export interface ComparisonDuplicate {
  provider: AgentProvider;
  name: string;
  kind: CapabilityKind;
  copies: AgentCapability[];
  /**
   * True when every copy carries the same content fingerprint — a redundant
   * install that is safe to clean up. False means the copies differ (or their
   * content could not be read): same name, different behavior, so one copy
   * shadows the other and the user should pick which one wins.
   */
  identicalContent: boolean;
}
