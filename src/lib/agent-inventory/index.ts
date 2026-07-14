import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { agentProviders, type AgentProvider } from "@/lib/types";
import { discoverClaude } from "./claude";
import { discoverCodex } from "./codex";
import { discoverPi } from "./pi";
import { isPathPresent, readSkillLock } from "./shared";
import type { InventoryScope, AgentInventory } from "./types";
import { discoverZcode } from "./zcode";

export type * from "./types";
export { buildComparisonRows } from "./normalize";

export interface ProviderInventoryPaths {
  configPath?: string;
  skillsPath?: string;
  instructionPath?: string;
}

export interface InventoryDiscoveryOptions {
  homeDir?: string;
  personalSkillRoots?: string[];
  paths?: Partial<Record<AgentProvider, ProviderInventoryPaths>>;
}

async function defaultPersonalRoots(homeDir: string): Promise<string[]> {
  const configured = (process.env.RELAY_PERSONAL_SKILL_ROOTS ?? "")
    .split(delimiter)
    .filter(Boolean);
  const conventional = join(homeDir, "Documents", "Projects", "agent-skills");
  if (await isPathPresent(conventional)) configured.push(conventional);
  return [...new Set(configured)];
}

export async function getAgentInventories(
  scope: InventoryScope,
  options: InventoryDiscoveryOptions = {},
): Promise<AgentInventory[]> {
  if (scope.kind !== "global") return [];
  const homeDir = options.homeDir ?? homedir();
  const personalSkillRoots =
    options.personalSkillRoots ?? (await defaultPersonalRoots(homeDir));
  const lockWarnings: AgentInventory["warnings"] = [];
  const skillLock = await readSkillLock(
    join(homeDir, ".agents", ".skill-lock.json"),
    lockWarnings,
  );
  const common = { homeDir, personalSkillRoots, skillLock };
  const inventories = await Promise.all([
    discoverCodex(common),
    discoverClaude(common),
    discoverZcode(common),
    discoverPi(common),
  ]);
  if (lockWarnings.length > 0) {
    for (const inventory of inventories)
      inventory.warnings.push(...lockWarnings);
  }
  return agentProviders.map(
    (provider) =>
      inventories.find((inventory) => inventory.provider === provider) ?? {
        provider,
        scope: "global",
        capabilities: [],
        warnings: [],
      },
  );
}
