import { join } from "node:path";
import { dedupeCapabilities } from "./normalize";
import {
  capability,
  discoverPluginMcps,
  discoverSkillRoots,
  objectValue,
  readInstruction,
  readJsonSource,
  safeAbsolutePath,
  type SkillLock,
} from "./shared";
import type { AgentCapability, AgentInventory } from "./types";

interface ZcodeOptions {
  homeDir: string;
  personalSkillRoots: string[];
  skillLock: SkillLock;
}

export async function discoverZcode({
  homeDir,
  personalSkillRoots,
  skillLock,
}: ZcodeOptions): Promise<AgentInventory> {
  const warnings: AgentInventory["warnings"] = [];
  const config = await readJsonSource(
    join(homeDir, ".zcode", "cli", "config.json"),
    warnings,
  );
  const registry = await readJsonSource(
    join(homeDir, ".zcode", "cli", "plugins", "installed_plugins.json"),
    warnings,
  );
  const pluginsConfig = objectValue(config?.plugins);
  const enabled = objectValue(pluginsConfig?.enabledPlugins) ?? {};
  const installed = Array.isArray(registry?.plugins) ? registry.plugins : [];
  const capabilities: AgentCapability[] = [];
  const skillContext = {
    provider: "zcode" as const,
    skillLock,
    personalSkillRoots,
  };

  for (const rawPlugin of installed) {
    const plugin = objectValue(rawPlugin);
    if (!plugin || typeof plugin.id !== "string") continue;
    const path = safeAbsolutePath(plugin.installPath);
    capabilities.push(
      capability("zcode", "plugin", plugin.id, {
        status: enabled[plugin.id] === true ? "enabled" : "disabled",
        packaging: "plugin",
        origin: "marketplace",
        sourceRepository:
          typeof plugin.marketplace === "string"
            ? plugin.marketplace
            : undefined,
        sourcePath: path,
      }),
    );
    if (path) {
      capabilities.push(
        ...(await discoverPluginMcps(
          "zcode",
          path,
          plugin.id,
          enabled[plugin.id] === true ? "enabled" : "disabled",
          warnings,
        )),
      );
      capabilities.push(
        ...(await discoverSkillRoots([join(path, "skills")], {
          ...skillContext,
          packaging: "plugin",
          origin: "marketplace",
          sourcePlugin: plugin.id,
          sourceRepository:
            typeof plugin.marketplace === "string"
              ? plugin.marketplace
              : undefined,
        })),
      );
    }
  }
  capabilities.push(
    ...(await discoverSkillRoots(
      [join(homeDir, ".zcode", "skills")],
      skillContext,
    )),
  );

  return {
    provider: "zcode",
    scope: "global",
    capabilities: dedupeCapabilities(capabilities),
    instructionFile: await readInstruction(
      join(homeDir, ".zcode", "AGENTS.md"),
      warnings,
    ),
    warnings,
  };
}
