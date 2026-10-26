import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { dedupeCapabilities } from "./normalize";
import { humanizeCron } from "./schedule";
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
  type SkillDiscoveryContext,
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

interface DesktopScheduledTask {
  displayName?: string;
  cronExpression?: string;
  enabled?: boolean;
  model?: string;
  cwd?: string;
  createdAt?: number;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * Claude Desktop keeps scheduling metadata (display title, cron, enabled flag,
 * model, working directory) in `scheduled-tasks.json` beside its Claude Code
 * sessions, scoped by account/org UUID directories. This is undocumented app
 * internals, so every lookup is tolerant: the most recently written file wins,
 * and a missing or malformed file yields an empty map. Fields such as
 * `approvedPermissions` and `notifySessionId` are deliberately not read.
 */
async function readDesktopScheduledTasks(
  homeDir: string,
): Promise<Map<string, DesktopScheduledTask>> {
  const base = join(
    homeDir,
    "Library",
    "Application Support",
    "Claude",
    "claude-code-sessions",
  );
  let newestPath: string | undefined;
  let newestMtime = -1;
  for (const outer of await readDirectoryEntries(base, {
    directoriesOnly: true,
  })) {
    for (const inner of await readDirectoryEntries(outer, {
      directoriesOnly: true,
    })) {
      const candidate = join(inner, "scheduled-tasks.json");
      try {
        const { mtimeMs } = await stat(candidate);
        if (mtimeMs > newestMtime) {
          newestMtime = mtimeMs;
          newestPath = candidate;
        }
      } catch {
        continue;
      }
    }
  }
  const tasks = new Map<string, DesktopScheduledTask>();
  if (!newestPath) return tasks;
  const store = await readJsonSource(newestPath, []);
  if (!store || !Array.isArray(store.scheduledTasks)) return tasks;
  for (const item of store.scheduledTasks) {
    const record = objectValue(item);
    const id = nonEmptyString(record?.id);
    if (!record || !id) continue;
    tasks.set(id, {
      displayName: nonEmptyString(record.displayName),
      cronExpression: nonEmptyString(record.cronExpression),
      enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
      model: nonEmptyString(record.model),
      cwd: safeAbsolutePath(record.cwd),
      createdAt:
        typeof record.createdAt === "number" ? record.createdAt : undefined,
    });
  }
  return tasks;
}

/**
 * Reads Claude's scheduled-task directories (`~/.claude/scheduled-tasks/<id>/`).
 * Each task is a SKILL.md with YAML frontmatter; the instruction body is
 * surfaced verbatim under the allowlist exception. The SKILL.md carries no
 * schedule or friendly title, so those are joined from Claude Desktop's
 * scheduled-task store by task id. Tasks absent from the store fall back to
 * the frontmatter name and `scheduleMissing: true`.
 */
export async function discoverClaudeScheduledTasks(
  homeDir: string,
): Promise<ScheduledTask[]> {
  const tasks: ScheduledTask[] = [];
  const root = join(homeDir, ".claude", "scheduled-tasks");
  const desktopTasks = await readDesktopScheduledTasks(homeDir);
  for (const entry of await readDirectoryEntries(root, {
    directoriesOnly: true,
  })) {
    const skillPath = join(entry, "SKILL.md");
    const content = await readTextSource(skillPath, []);
    if (!content) continue;
    const { data, body } = parseFrontmatter(content);
    const id = basename(entry);
    const desktop = desktopTasks.get(id);
    const cron = desktop?.cronExpression;
    tasks.push({
      id,
      name: desktop?.displayName ?? data.name ?? id,
      description: data.description,
      provider: "claude",
      scheduleRaw: cron,
      scheduleHuman: cron ? humanizeCron(cron) : undefined,
      scheduleMissing: !cron,
      status: desktop?.enabled === false ? "paused" : "active",
      model: desktop?.model,
      workingDirectories: desktop?.cwd ? [desktop.cwd] : undefined,
      instructionBody: body,
      instructionFormat: "skill_md",
      sourcePath: skillPath,
      createdAt: desktop?.createdAt,
      warnings: [],
    });
  }
  return tasks;
}

/**
 * Claude Desktop bundles a set of Anthropic-managed skills (morning brief,
 * docx/pptx/xlsx, schedule, skill-creator, ...) per session under
 * `~/Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin/<session>/<session>/skills`.
 * The desktop app owns this bundle directly and never registers it in
 * `installed_plugins.json`, so it's otherwise invisible to inventory. Every
 * session directory holds an identical copy of the same bundle, so only the
 * most recently modified one is surfaced.
 */
async function newestDesktopSkillsPluginRoot(
  homeDir: string,
): Promise<{ skillsRoot: string; pluginName?: string } | undefined> {
  const base = join(
    homeDir,
    "Library",
    "Application Support",
    "Claude",
    "local-agent-mode-sessions",
    "skills-plugin",
  );
  let newest:
    { skillsRoot: string; pluginName?: string; mtimeMs: number } | undefined;
  for (const outer of await readDirectoryEntries(base, {
    directoriesOnly: true,
  })) {
    for (const inner of await readDirectoryEntries(outer, {
      directoriesOnly: true,
    })) {
      const skillsRoot = join(inner, "skills");
      let mtimeMs: number;
      try {
        mtimeMs = (await stat(skillsRoot)).mtimeMs;
      } catch {
        continue;
      }
      if (newest && mtimeMs <= newest.mtimeMs) continue;
      const manifest = await readJsonSource(
        join(inner, ".claude-plugin", "plugin.json"),
        [],
      );
      const pluginName =
        typeof manifest?.name === "string" ? manifest.name : undefined;
      newest = { skillsRoot, pluginName, mtimeMs };
    }
  }
  return newest;
}

async function discoverClaudeDesktopBuiltinSkills(
  homeDir: string,
  skillContext: SkillDiscoveryContext,
): Promise<AgentCapability[]> {
  const newest = await newestDesktopSkillsPluginRoot(homeDir);
  if (!newest) return [];
  return discoverSkillRoots([newest.skillsRoot], {
    ...skillContext,
    packaging: "built_in",
    origin: "built_in",
    sourcePlugin: newest.pluginName,
    status: "installed",
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
      [join(homeDir, ".claude", "skills"), join(homeDir, ".agents", "skills")],
      skillContext,
    )),
  );
  capabilities.push(
    ...(await discoverClaudeDesktopBuiltinSkills(homeDir, skillContext)),
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
