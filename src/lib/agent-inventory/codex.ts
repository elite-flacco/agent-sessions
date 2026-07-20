import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { dedupeCapabilities } from "./normalize";
import {
  capability,
  compareVersionDirs,
  discoverPluginMcps,
  discoverSkillRoots,
  pluginStatusWithPresence,
  readInstruction,
  readTextSource,
  safeAbsolutePath,
  staleVersionsWarning,
  type SkillDiscoveryContext,
  type SkillLock,
} from "./shared";
import type {
  AgentCapability,
  AgentInventory,
  InventoryWarning,
} from "./types";

interface CodexOptions {
  homeDir: string;
  personalSkillRoots: string[];
  skillLock: SkillLock;
}

interface TomlTable {
  name: string;
  body: string;
}

function tables(content: string): TomlTable[] {
  const matches = [...content.matchAll(/^\s*\[([^\]]+)]\s*$/gm)];
  return matches.map((match, index) => ({
    name: match[1] ?? "",
    body: content.slice(
      (match.index ?? 0) + match[0].length,
      matches[index + 1]?.index ?? content.length,
    ),
  }));
}

function tableKey(name: string, prefix: string): string | undefined {
  const rest = name.slice(prefix.length);
  const match = rest.match(/^(?:"([^"]+)"|([A-Za-z0-9_-]+))/);
  return match?.[1] ?? match?.[2];
}

function enabled(body: string): boolean {
  return !/^\s*enabled\s*=\s*false\s*(?:#.*)?$/m.test(body);
}

function sourcePath(body: string): string | undefined {
  const source = body.match(/^\s*source\s*=\s*"([^"]+)"\s*$/m)?.[1];
  return safeAbsolutePath(source);
}

/**
 * Codex `config.toml` plugin tables rarely carry a `source` path. The installed
 * plugin files live under `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`.
 * We resolve the lexicographically-highest version directory so re-installs that
 * leave stale hashes behind still surface the active copy.
 */
async function resolveCachedPluginRoot(
  homeDir: string,
  pluginId: string,
  warnings: InventoryWarning[],
): Promise<string | undefined> {
  const atIndex = pluginId.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === pluginId.length - 1) return undefined;
  const plugin = pluginId.slice(0, atIndex);
  const marketplace = pluginId.slice(atIndex + 1);
  const cacheRoot = join(
    homeDir,
    ".codex",
    "plugins",
    "cache",
    marketplace,
    plugin,
  );
  let entries;
  try {
    entries = await readdir(cacheRoot, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const versions = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareVersionDirs);
  if (versions.length === 0) return undefined;
  if (versions.length > 1) warnings.push(staleVersionsWarning(cacheRoot));
  return join(cacheRoot, versions[versions.length - 1]!);
}

export async function discoverCodex({
  homeDir,
  personalSkillRoots,
  skillLock,
}: CodexOptions): Promise<AgentInventory> {
  const warnings: AgentInventory["warnings"] = [];
  const configPath = join(homeDir, ".codex", "config.toml");
  const config = await readTextSource(configPath, warnings);
  const capabilities: AgentCapability[] = [];
  const pluginSkills: AgentCapability[] = [];
  const context: SkillDiscoveryContext = {
    provider: "codex",
    skillLock,
    personalSkillRoots,
  };

  if (config) {
    const seenMcps = new Set<string>();
    for (const table of tables(config)) {
      if (table.name.startsWith("plugins.")) {
        const name = tableKey(table.name, "plugins.");
        if (!name) continue;
        const explicitPath = sourcePath(table.body);
        const path =
          explicitPath ??
          (await resolveCachedPluginRoot(homeDir, name, warnings));
        const pluginStatus = await pluginStatusWithPresence(
          enabled(table.body) ? "enabled" : "disabled",
          path,
        );
        // Split `name` ("<plugin>@<marketplace>") so the marketplace can be
        // surfaced as sourceRepository, matching how Claude/Zcode publish
        // plugin capabilities. Skills contributed by this plugin inherit the
        // same sourceRepository via the discovery context.
        const atIndex = name.lastIndexOf("@");
        const marketplace =
          atIndex > 0 && atIndex < name.length - 1
            ? name.slice(atIndex + 1)
            : undefined;
        capabilities.push(
          capability("codex", "plugin", name, {
            status: pluginStatus,
            packaging: "plugin",
            origin: "marketplace",
            sourceRepository: marketplace,
            sourcePath: path,
          }),
        );
        if (path) {
          pluginSkills.push(
            ...(await discoverPluginMcps(
              "codex",
              path,
              name,
              pluginStatus,
              warnings,
            )),
          );
          pluginSkills.push(
            ...(await discoverSkillRoots([join(path, "skills")], {
              ...context,
              packaging: "plugin",
              origin: "marketplace",
              sourcePlugin: name,
              sourceRepository: marketplace,
              status: pluginStatus,
            })),
          );
        }
      }
      if (table.name.startsWith("mcp_servers.")) {
        const name = tableKey(table.name, "mcp_servers.");
        if (!name || seenMcps.has(name)) continue;
        seenMcps.add(name);
        capabilities.push(
          capability("codex", "mcp", name, {
            status: enabled(table.body) ? "enabled" : "disabled",
            origin: "personal",
          }),
        );
      }
    }
  }

  capabilities.push(
    ...(await discoverSkillRoots([join(homeDir, ".codex", "skills")], context)),
    ...pluginSkills,
  );

  return {
    provider: "codex",
    scope: "global",
    capabilities: dedupeCapabilities(capabilities),
    instructionFile: await readInstruction(
      join(homeDir, ".codex", "AGENTS.md"),
      warnings,
    ),
    warnings,
  };
}
