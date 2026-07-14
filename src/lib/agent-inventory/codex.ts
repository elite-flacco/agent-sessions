import { join } from "node:path";
import { dedupeCapabilities } from "./normalize";
import {
  capability,
  discoverPluginMcps,
  discoverSkillRoots,
  readInstruction,
  readTextSource,
  safeAbsolutePath,
  type SkillDiscoveryContext,
  type SkillLock,
} from "./shared";
import type { AgentCapability, AgentInventory } from "./types";

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
  return !/^\s*enabled\s*=\s*false\s*$/m.test(body);
}

function sourcePath(body: string): string | undefined {
  const source = body.match(/^\s*source\s*=\s*"([^"]+)"\s*$/m)?.[1];
  return safeAbsolutePath(source);
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
        const path = sourcePath(table.body);
        capabilities.push(
          capability("codex", "plugin", name, {
            status: enabled(table.body) ? "enabled" : "disabled",
            packaging: "plugin",
            origin: "marketplace",
            sourcePath: path,
          }),
        );
        if (path) {
          pluginSkills.push(
            ...(await discoverPluginMcps(
              "codex",
              path,
              name,
              enabled(table.body) ? "enabled" : "disabled",
              warnings,
            )),
          );
          pluginSkills.push(
            ...(await discoverSkillRoots([join(path, "skills")], {
              ...context,
              packaging: "plugin",
              origin: "marketplace",
              sourcePlugin: name,
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
