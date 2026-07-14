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
}

export interface InstructionFile {
  filename: string;
  sourcePath: string;
  content: string;
  contentFingerprint: string;
}

export interface InventoryWarning {
  sourcePath: string;
  code: "unreadable" | "malformed" | "unsupported";
  message: string;
}

export interface AgentInventory {
  provider: AgentProvider;
  scope: "global";
  capabilities: AgentCapability[];
  instructionFile?: InstructionFile;
  warnings: InventoryWarning[];
}

export interface ComparisonRow {
  key: string;
  name: string;
  kind: CapabilityKind | "instruction";
  cells: Partial<Record<AgentProvider, AgentCapability>>;
  instructionCells?: Partial<Record<AgentProvider, InstructionFile>>;
  isDiscrepancy: boolean;
}
