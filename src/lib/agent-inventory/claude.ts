import { basename, join } from "node:path";
import { dedupeCapabilities } from "./normalize";
import {
  capability,
  discoverPluginMcps,
  discoverSkillRoots,
  objectValue,
  parseFrontmatter,
  pluginStatusWithPresence,
  readDirectoryEntries,
  readInstruction,
  readJsonSource,
  readTextSource,
  safeAbsolutePath,
  type SkillLock,
} from "./shared";
import type { AgentCapability, AgentInventory, ScheduledTask } from "./types";

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

/**
 * Reads Claude's scheduled-task directories (`~/.claude/scheduled-tasks/<id>/`).
 * Each task is a SKILL.md with YAML frontmatter. Claude doesn't store the
 * schedule in-file — `scheduleMissing` is always true and the instruction body
 * (the SKILL.md body) is surfaced verbatim under the allowlist exception.
 */
export async function discoverClaudeScheduledTasks(
  homeDir: string,
): Promise<ScheduledTask[]> {
  const tasks: ScheduledTask[] = [];
  const root = join(homeDir, ".claude", "scheduled-tasks");
  for (const entry of await readDirectoryEntries(root)) {
    const skillPath = join(entry, "SKILL.md");
    const content = await readTextSource(skillPath, []);
    if (!content) continue;
    const { data, body } = parseFrontmatter(content);
    const id = basename(entry);
    tasks.push({
      id,
      name: data.name ?? id,
      description: data.description,
      provider: "claude",
      scheduleMissing: true,
      status: "active",
      instructionBody: body,
      instructionFormat: "skill_md",
      sourcePath: skillPath,
      warnings: [],
    });
  }
  return tasks;
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
    // Absence from enabledPlugins means the enable state is unknown, not that
    // the plugin is off — surface "installed" so it never silently disappears.
    // Only an explicit `false` is a deliberate disable.
    const configuredStatus =
      enabled[plugin.id] === true
        ? "enabled"
        : enabled[plugin.id] === false
          ? "disabled"
          : "installed";
    const pluginStatus = await pluginStatusWithPresence(
      configuredStatus,
      plugin.installPath,
    );
    // Split `plugin.id` ("<plugin>@<marketplace>") so the marketplace can be
    // surfaced as sourceRepository, matching how Zcode publishes plugin
    // capabilities. Skills contributed by this plugin inherit the same
    // sourceRepository via the discovery context.
    const atIndex = plugin.id.lastIndexOf("@");
    const marketplace =
      atIndex > 0 && atIndex < plugin.id.length - 1
        ? plugin.id.slice(atIndex + 1)
        : undefined;
    capabilities.push(
      capability("claude", "plugin", plugin.id, {
        status: pluginStatus,
        packaging: "plugin",
        origin: "marketplace",
        sourceRepository: marketplace,
        sourcePath: plugin.installPath,
      }),
    );
    if (plugin.installPath) {
      capabilities.push(
        ...(await discoverPluginMcps(
          "claude",
          plugin.installPath,
          plugin.id,
          pluginStatus,
          warnings,
        )),
      );
      capabilities.push(
        ...(await discoverSkillRoots([join(plugin.installPath, "skills")], {
          ...skillContext,
          packaging: "plugin",
          origin: "marketplace",
          sourcePlugin: plugin.id,
          sourceRepository: marketplace,
          status: pluginStatus,
        })),
      );
    }
  }

  const globalConfig = await readJsonSource(
    join(homeDir, ".claude.json"),
    warnings,
  );
  for (const name of Object.keys(objectValue(globalConfig?.mcpServers) ?? {})) {
    capabilities.push(
      capability("claude", "mcp", name, {
        status: "enabled",
        origin: "personal",
      }),
    );
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
    scheduledTasks: await discoverClaudeScheduledTasks(homeDir),
    instructionFile: await readInstruction(
      join(homeDir, ".claude", "CLAUDE.md"),
      warnings,
    ),
    warnings,
  };
}
