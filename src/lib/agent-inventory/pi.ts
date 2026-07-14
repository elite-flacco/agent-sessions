import { basename, extname, join } from "node:path";
import { dedupeCapabilities } from "./normalize";
import {
  capability,
  discoverSkillRoots,
  listExtensionFiles,
  objectValue,
  readInstruction,
  readJsonSource,
  type SkillLock,
} from "./shared";
import type { AgentCapability, AgentInventory } from "./types";

interface PiOptions {
  homeDir: string;
  personalSkillRoots: string[];
  skillLock: SkillLock;
}

function packageNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    const object = objectValue(item);
    return typeof object?.source === "string" ? [object.source] : [];
  });
}

export async function discoverPi({
  homeDir,
  personalSkillRoots,
  skillLock,
}: PiOptions): Promise<AgentInventory> {
  const warnings: AgentInventory["warnings"] = [];
  const agentRoot = join(homeDir, ".pi", "agent");
  const settings = await readJsonSource(
    join(agentRoot, "settings.json"),
    warnings,
  );
  const capabilities: AgentCapability[] = await discoverSkillRoots(
    [join(agentRoot, "skills"), join(homeDir, ".agents", "skills")],
    { provider: "pi", skillLock, personalSkillRoots },
  );

  for (const path of await listExtensionFiles(join(agentRoot, "extensions"))) {
    capabilities.push(
      capability("pi", "plugin", basename(path, extname(path)), {
        status: "enabled",
        sourcePath: path,
      }),
    );
  }
  for (const name of packageNames(settings?.packages)) {
    capabilities.push(
      capability("pi", "plugin", name, {
        status: "enabled",
        origin: "marketplace",
      }),
    );
  }

  return {
    provider: "pi",
    scope: "global",
    capabilities: dedupeCapabilities(capabilities),
    instructionFile: await readInstruction(
      join(agentRoot, "AGENTS.md"),
      warnings,
    ),
    warnings,
  };
}
