import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { agentProviders, type AgentProvider } from "@/lib/types";
import { discoverClaude } from "./claude";
import { discoverCodex } from "./codex";
import { canonicalCapabilityName } from "./normalize";
import { discoverPi } from "./pi";
import { isPathPresent, readSkillLock } from "./shared";
import type { InventoryScope, AgentInventory } from "./types";
import { discoverZcode } from "./zcode";

export type * from "./types";
export { buildComparisonRows, findComparisonDuplicates } from "./normalize";

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
  // Reconcile the shared skills.sh lockfile against what discovery actually
  // found: an entry with no installed skill anywhere is a half-uninstalled
  // leftover worth cleaning up. The warning is attached alongside the other
  // lock warnings (every provider scans the same lockfile).
  const installedSkillNames = new Set(
    inventories.flatMap((inventory) =>
      inventory.capabilities
        .filter((capability) => capability.kind === "skill")
        .map((capability) => canonicalCapabilityName(capability.name)),
    ),
  );
  for (const name of Object.keys(skillLock)) {
    if (!installedSkillNames.has(canonicalCapabilityName(name))) {
      lockWarnings.push({
        sourcePath: join(homeDir, ".agents", ".skill-lock.json"),
        code: "stale",
        message: `Skill "${name}" is tracked in the skills.sh lockfile but not installed for any agent.`,
      });
    }
  }
  if (lockWarnings.length > 0) {
    for (const inventory of inventories)
      inventory.warnings.push(...lockWarnings);
  }
  // Disabled capabilities stay in the inventory: the comparison layer needs
  // them to tell "deliberately turned off on this agent" apart from "never
  // installed" (which would otherwise be flagged as a missing-install fix).
  // Views that only want active capabilities filter on status themselves.
  return agentProviders.map(
    (provider) =>
      inventories.find((item) => item.provider === provider) ?? {
        provider,
        scope: "global",
        capabilities: [],
        warnings: [],
      },
  );
}
