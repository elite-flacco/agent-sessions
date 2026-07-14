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

interface ClaudeOptions {
  homeDir: string;
  personalSkillRoots: string[];
  skillLock: SkillLock;
}

interface InstalledPlugin {
  id: string;
  installPath?: string;
}

function installedPlugins(value: unknown): InstalledPlugin[] {
  const plugins = objectValue(value);
  if (!plugins) return [];
  return Object.entries(plugins).map(([id, installs]) => {
    const install = Array.isArray(installs)
      ? objectValue(installs[0])
      : objectValue(installs);
    return { id, installPath: safeAbsolutePath(install?.installPath) };
  });
}

export async function discoverClaude({
  homeDir,
  personalSkillRoots,
  skillLock,
}: ClaudeOptions): Promise<AgentInventory> {
  const warnings: AgentInventory["warnings"] = [];
  const settings = await readJsonSource(
    join(homeDir, ".claude", "settings.json"),
    warnings,
  );
  const registry = await readJsonSource(
    join(homeDir, ".claude", "plugins", "installed_plugins.json"),
    warnings,
  );
  const enabled = objectValue(settings?.enabledPlugins) ?? {};
  const capabilities: AgentCapability[] = [];
  const skillContext = {
    provider: "claude" as const,
    skillLock,
    personalSkillRoots,
  };

  for (const plugin of installedPlugins(registry?.plugins)) {
    capabilities.push(
      capability("claude", "plugin", plugin.id, {
        status: enabled[plugin.id] === true ? "enabled" : "disabled",
        packaging: "plugin",
        origin: "marketplace",
        sourcePath: plugin.installPath,
      }),
    );
    if (plugin.installPath) {
      capabilities.push(
        ...(await discoverPluginMcps(
          "claude",
          plugin.installPath,
          plugin.id,
          enabled[plugin.id] === true ? "enabled" : "disabled",
          warnings,
        )),
      );
      capabilities.push(
        ...(await discoverSkillRoots([join(plugin.installPath, "skills")], {
          ...skillContext,
          packaging: "plugin",
          origin: "marketplace",
          sourcePlugin: plugin.id,
        })),
      );
    }
  }

  const globalConfig = await readJsonSource(
    join(homeDir, ".claude.json"),
    warnings,
  );
  for (const name of Object.keys(objectValue(globalConfig?.mcpServers) ?? {})) {
    capabilities.push(capability("claude", "mcp", name, { status: "enabled" }));
  }
  capabilities.push(
    ...(await discoverSkillRoots(
      [join(homeDir, ".claude", "skills")],
      skillContext,
    )),
  );

  return {
    provider: "claude",
    scope: "global",
    capabilities: dedupeCapabilities(capabilities),
    instructionFile: await readInstruction(
      join(homeDir, ".claude", "CLAUDE.md"),
      warnings,
    ),
    warnings,
  };
}
