import { basename, join } from "node:path";
import { readdir } from "node:fs/promises";
import { dedupeCapabilities } from "./normalize";
import { humanizeSchedule } from "./schedule";
import {
  capability,
  compareVersionDirs,
  discoverPluginMcps,
  discoverSkillRoots,
  orphanedTargetWarning,
  pluginStatusWithPresence,
  readDirectoryEntries,
  readInstruction,
  readJsonSource,
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
  ScheduledTask,
  ScheduledTaskStatus,
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
  // Matches both `[table]` and `[[array-of-tables]]` headers. Array tables
  // (e.g. `[[skills.config]]`) must terminate the preceding table's body —
  // otherwise their `enabled = false` lines would leak into it.
  const matches = [...content.matchAll(/^\s*\[\[?([^\][]+)]]?\s*$/gm)];
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

function skillConfigName(body: string): string | undefined {
  return body.match(/^\s*name\s*=\s*"([^"]+)"\s*(?:#.*)?$/m)?.[1];
}

/**
 * Codex records per-skill enable state in `[[skills.config]]` entries whose
 * `name` is `<plugin-short-name>:<skill>` for plugin-contributed skills or a
 * bare `<skill>` for standalone ones. Apply explicit `enabled = false`
 * overrides so individually disabled skills stop inheriting their plugin's
 * enabled status. Broken (unavailable) skills keep their status.
 */
function applySkillOverrides(
  capabilities: AgentCapability[],
  overrides: Map<string, boolean>,
): AgentCapability[] {
  if (overrides.size === 0) return capabilities;
  return capabilities.map((capability) => {
    if (capability.kind !== "skill") return capability;
    if (capability.status !== "enabled" && capability.status !== "installed") {
      return capability;
    }
    const shortPlugin = capability.sourcePlugin?.split("@")[0];
    const canonicalName = capability.name.toLocaleLowerCase();
    const key =
      shortPlugin && !canonicalName.startsWith(`${shortPlugin}:`)
        ? `${shortPlugin}:${canonicalName}`
        : canonicalName;
    return overrides.get(key) === false
      ? { ...capability, status: "disabled" }
      : capability;
  });
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

/**
 * Parses `key = value` lines and `key = [a, b]` arrays from a flat TOML body.
 * Used for `automation.toml` which has no `[section]` tables — just top-level
 * keys. Single-line values only; multi-line triple-quoted strings are not
 * emitted by Codex automations today.
 */
function parseTomlValues(body: string): {
  values: Record<string, string>;
  arrays: Record<string, string[]>;
} {
  const values: Record<string, string> = {};
  const arrays: Record<string, string[]> = {};
  for (const line of body.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][\w]*)\s*=\s*(.+?)\s*$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (raw.startsWith("[")) {
      const inner = raw.replace(/^\[/, "").replace(/\]$/, "");
      arrays[key] = inner
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);
    } else {
      values[key] = raw.replace(/^"|"$/g, "");
    }
  }
  return { values, arrays };
}

function statusFromToml(raw: string | undefined): ScheduledTaskStatus {
  switch ((raw ?? "").toUpperCase()) {
    case "ACTIVE":
      return "active";
    case "PAUSED":
      return "paused";
    case "DISABLED":
      return "disabled";
    default:
      return "unknown";
  }
}

/**
 * Reads the id → display-name map of Codex's local projects from
 * `~/.codex/.codex-global-state.json`. Only ids and names are taken; nothing
 * else in that file enters the inventory.
 *
 * Returns `undefined` when the state file is missing or malformed, which the
 * caller treats as "unknown" rather than "no projects" — an unreadable state
 * file must never make every automation look orphaned.
 */
async function readCodexProjectNames(
  homeDir: string,
): Promise<Map<string, string> | undefined> {
  const parsed = await readJsonSource(
    join(homeDir, ".codex", ".codex-global-state.json"),
    [],
  );
  const projects = parsed?.["local-projects"];
  if (!projects || typeof projects !== "object") return undefined;
  const names = new Map<string, string>();
  for (const [id, value] of Object.entries(projects)) {
    const name = (value as { name?: unknown } | null)?.name;
    names.set(id, typeof name === "string" && name ? name : id);
  }
  return names;
}

/**
 * Reads Codex automations from `~/.codex/automations/` (one `automation.toml`
 * per task). Each TOML file describes one scheduled task (rrule schedule,
 * model, target, and the prompt body which is surfaced verbatim under the
 * allowlist exception). Returns `{ tasks, warnings }` so the caller can merge
 * per-file read warnings into the inventory-level warnings array.
 */
export async function discoverCodexScheduledTasks(homeDir: string): Promise<{
  tasks: ScheduledTask[];
  warnings: ScheduledTask["warnings"];
}> {
  const warnings: ScheduledTask["warnings"] = [];
  const automationsDir = join(homeDir, ".codex", "automations");
  const projectNames = await readCodexProjectNames(homeDir);
  const tasks: ScheduledTask[] = [];
  for (const entry of await readDirectoryEntries(automationsDir, {
    directoriesOnly: true,
  })) {
    const tomlPath = join(entry, "automation.toml");
    const content = await readTextSource(tomlPath, warnings);
    if (!content) continue;
    const { values, arrays } = parseTomlValues(content);
    const id = values.id ?? basename(entry);
    const rrule = values.rrule;
    const scheduleHuman = rrule ? humanizeSchedule(rrule) : undefined;
    const target = values.target;
    const projectId = target?.match(/project_id\s*=\s*"([^"]+)"/)?.[1];
    const projectName = projectId ? projectNames?.get(projectId) : undefined;
    // A target Codex no longer knows about is why its editor reports the task
    // as nonexistent, so the row has to say so. Only judged when the project
    // list was actually readable.
    const taskWarnings: ScheduledTask["warnings"] =
      projectId && projectNames && !projectName
        ? [orphanedTargetWarning(tomlPath, projectId)]
        : [];
    const descriptionLine = (values.prompt ?? "")
      .split("\n")
      .map((s) => s.trim())
      .find((s) => s.length > 0);
    tasks.push({
      id,
      name: values.name ?? id,
      description: descriptionLine,
      provider: "codex",
      scheduleRaw: rrule,
      scheduleHuman,
      scheduleMissing: !rrule,
      status: statusFromToml(values.status),
      model: values.model,
      targetProject: projectId,
      targetProjectName: projectName,
      workingDirectories: arrays.cwds,
      instructionBody: values.prompt,
      instructionFormat: "toml_prompt",
      sourcePath: tomlPath,
      createdAt: Number.parseInt(values.created_at ?? "", 10) || undefined,
      updatedAt: Number.parseInt(values.updated_at ?? "", 10) || undefined,
      warnings: taskWarnings,
    });
  }
  return { tasks, warnings };
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

  const skillOverrides = new Map<string, boolean>();
  if (config) {
    const seenMcps = new Set<string>();
    for (const table of tables(config)) {
      if (table.name === "skills.config") {
        const name = skillConfigName(table.body);
        if (name) {
          skillOverrides.set(name.toLocaleLowerCase(), enabled(table.body));
        }
        continue;
      }
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

  const { tasks: scheduledTasks, warnings: taskWarnings } =
    await discoverCodexScheduledTasks(homeDir);
  warnings.push(...taskWarnings);
  return {
    provider: "codex",
    scope: "global",
    capabilities: dedupeCapabilities(
      applySkillOverrides(capabilities, skillOverrides),
    ),
    scheduledTasks,
    instructionFile: await readInstruction(
      join(homeDir, ".codex", "AGENTS.md"),
      warnings,
    ),
    warnings,
  };
}
