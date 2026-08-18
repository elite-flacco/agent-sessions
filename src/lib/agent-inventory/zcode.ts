import { join } from "node:path";
import {
  listZcodeAutomations,
  listZcodeWorkflowDefinitions,
} from "@/lib/zcode-db";
import { dedupeCapabilities } from "./normalize";
import { humanizeCron } from "./schedule";
import {
  capability,
  discoverCachePlugins,
  discoverPluginMcps,
  discoverSkillRoots,
  objectValue,
  pluginStatusWithPresence,
  readInstruction,
  readJsonSource,
  readTextSource,
  safeAbsolutePath,
  type SkillLock,
} from "./shared";
import type {
  AgentCapability,
  AgentInventory,
  ScheduledTask,
  ScheduledTaskStatus,
} from "./types";

interface ZcodeOptions {
  homeDir: string;
  personalSkillRoots: string[];
  skillLock: SkillLock;
}

async function readScriptBody(
  scriptPath: string | undefined,
): Promise<string | undefined> {
  if (!scriptPath) return undefined;
  // Local warnings list — script read failure shouldn't poison the inventory.
  return readTextSource(scriptPath, []);
}

function zcodeAutomationStatus(
  enabled: boolean,
  lifecycleStatus: string,
): ScheduledTaskStatus {
  if (!enabled) return "paused";
  if (lifecycleStatus === "active") return "active";
  if (lifecycleStatus === "completed") return "completed";
  return "unknown";
}

/**
 * Reads Zcode's current-generation automations (the CronCreate/CronList
 * backing store at `~/.zcode/v2/tasks-index.sqlite`). The prompt body is
 * surfaced verbatim under the scheduled-task allowlist exception — that prose
 * is user-authored. Fields like `last_error`, `bot_delivery_target`, and
 * `target_task_id` are deliberately not surfaced. There is no per-task file,
 * so `sourcePath` carries the workspace the automation is bound to.
 */
function discoverZcodeV2Automations(): ScheduledTask[] {
  const automations = listZcodeAutomations();
  if (!automations) return [];
  return automations.map((automation) => ({
    id: automation.id,
    name: automation.title || automation.id,
    description:
      automation.prompt
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0) || undefined,
    provider: "zcode",
    scheduleRaw: automation.cronExpr || undefined,
    scheduleHuman: automation.cronExpr
      ? humanizeCron(automation.cronExpr)
      : undefined,
    scheduleMissing: !automation.cronExpr,
    status: zcodeAutomationStatus(
      automation.enabled,
      automation.lifecycleStatus,
    ),
    model: automation.model,
    workingDirectories: automation.workspacePath
      ? [automation.workspacePath]
      : undefined,
    instructionBody: automation.prompt || undefined,
    instructionFormat: "prompt",
    sourcePath: automation.workspacePath || "",
    createdAt: automation.timeCreated || undefined,
    updatedAt: automation.timeUpdated || undefined,
    nextRunAt: automation.nextRunAt,
    runCount: automation.runCount || undefined,
    maxRuns: automation.maxRuns,
    warnings: [],
  }));
}

/**
 * Reads scheduled-task candidates from Zcode's legacy `workflow_definition`
 * table via the shared `zcode-db` reader. Sets `scheduleMissing: true` always:
 * the `meta_json` schedule shape is unobservable without a real row, so we
 * don't guess. The script body (`script_path` file contents) is surfaced
 * verbatim under the allowlist exception.
 */
async function discoverZcodeLegacyWorkflowTasks(): Promise<ScheduledTask[]> {
  const definitions = listZcodeWorkflowDefinitions();
  if (!definitions) return [];
  const tasks: ScheduledTask[] = [];
  for (const def of definitions) {
    const body = await readScriptBody(def.scriptPath);
    tasks.push({
      id: def.id,
      name: def.name,
      provider: "zcode",
      scheduleMissing: true,
      status: def.enabled ? "active" : "disabled",
      instructionBody: body,
      instructionFormat: "script",
      sourcePath: def.scriptPath ?? "",
      createdAt: def.timeCreated,
      updatedAt: def.timeUpdated,
      warnings:
        body === undefined && def.scriptPath
          ? [
              {
                sourcePath: def.scriptPath,
                code: "unreadable" as const,
                message: "Could not read workflow script.",
              },
            ]
          : [],
    });
  }
  return tasks;
}

/**
 * Zcode scheduled tasks come from the v2 automations store, with the legacy
 * `workflow_definition` rows kept as a fallback for older CLI generations.
 * Ids practically cannot collide (distinct formats), but v2 wins if one does.
 */
export async function discoverZcodeScheduledTasks(): Promise<ScheduledTask[]> {
  const v2 = discoverZcodeV2Automations();
  const v2Ids = new Set(v2.map((task) => task.id));
  const legacy = await discoverZcodeLegacyWorkflowTasks();
  return [...v2, ...legacy.filter((task) => !v2Ids.has(task.id))];
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
    // Same rule as the cache walker: absence from enabledPlugins is an
    // unknown state ("installed"), only an explicit `false` reads as disabled.
    const configuredStatus =
      enabled[plugin.id] === true
        ? "enabled"
        : enabled[plugin.id] === false
          ? "disabled"
          : "installed";
    const pluginStatus = await pluginStatusWithPresence(configuredStatus, path);
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
    scheduledTasks: await discoverZcodeScheduledTasks(),
    instructionFile: await readInstruction(
      join(homeDir, ".zcode", "AGENTS.md"),
      warnings,
    ),
    warnings,
  };
}
