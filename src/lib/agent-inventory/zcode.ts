import { join } from "node:path";
import { dedupeCapabilities } from "./normalize";
import {
  capability,
  discoverCachePlugins,
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

  for (const [name, server] of Object.entries(
    objectValue(objectValue(config?.mcp)?.servers) ?? {},
  )) {
    if (!objectValue(server)) continue;
    capabilities.push(
      capability("zcode", "mcp", name, {
        status: "enabled",
        origin: "personal",
      }),
    );
  }

  const knownIds = new Set<string>();
  for (const rawPlugin of installed) {
    const plugin = objectValue(rawPlugin);
    if (!plugin || typeof plugin.id !== "string") continue;
    knownIds.add(plugin.id);
    const path = safeAbsolutePath(plugin.installPath);
    const pluginStatus = enabled[plugin.id] === true ? "enabled" : "disabled";
    capabilities.push(
      capability("zcode", "plugin", plugin.id, {
        status: pluginStatus,
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
          pluginStatus,
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
          status: pluginStatus,
        })),
      );
    }
  }

  // The Zcode UI surfaces cache-only marketplace plugins that have not been
  // recorded in installed_plugins.json; walk the cache directory to keep parity.
  capabilities.push(
    ...(await discoverCachePlugins(
      "zcode",
      join(homeDir, ".zcode", "cli", "plugins", "cache"),
      knownIds,
      enabled,
      warnings,
      skillContext,
    )),
  );

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
