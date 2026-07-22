import type { AgentInventory } from "@/lib/agent-inventory";
import { canonicalCapabilityName } from "@/lib/agent-inventory/normalize";
import {
  agentProviders,
  type AgentProvider,
  type CapabilityLookup,
  type CapabilityUsage,
} from "@/lib/types";

const ACTIVE_STATUSES = new Set(["enabled", "installed"]);
const SAFE_NAME = /^[\p{L}\p{N}][\p{L}\p{N}_.:@ -]{0,159}$/u;
const READ_LIKE_TOOL = /^(read|exec|exec_command|bash)$/i;
const READ_MARKER =
  /\b(cat|sed|head|tail|less|bat|rg|grep|readFile|Get-Content)\b/i;
const PATH_START_BOUNDARY = /[\s"'`=:[\]{}(),;|&<>]/;
const PATH_END_BOUNDARY = /[\s"'`;|&<>()]/;

function safeName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  return SAFE_NAME.test(name) && !name.includes("/") && !name.includes("\\")
    ? name
    : undefined;
}

function safeCanonicalName(value: unknown): string | undefined {
  return typeof value === "string"
    ? safeName(canonicalCapabilityName(value))
    : undefined;
}

function skillFile(path: string): string {
  return path.endsWith(".md") ? path : `${path}/SKILL.md`;
}

function emptyLookup(): {
  skillFiles: Map<string, string>;
  mcpNames: Map<string, string>;
} {
  return { skillFiles: new Map(), mcpNames: new Map() };
}

export function buildCapabilityLookups(
  inventories: AgentInventory[],
): Record<AgentProvider, CapabilityLookup> {
  const lookups = Object.fromEntries(
    agentProviders.map((provider) => [provider, emptyLookup()]),
  ) as Record<
    AgentProvider,
    { skillFiles: Map<string, string>; mcpNames: Map<string, string> }
  >;

  for (const inventory of inventories) {
    const lookup = lookups[inventory.provider];
    for (const capability of inventory.capabilities) {
      if (!ACTIVE_STATUSES.has(capability.status)) continue;
      const name = safeCanonicalName(capability.name);
      if (!name) continue;

      if (capability.kind === "skill") {
        for (const sourcePath of [
          capability.sourcePath,
          capability.canonicalSourcePath,
        ]) {
          if (sourcePath) lookup.skillFiles.set(skillFile(sourcePath), name);
        }
      }
      if (capability.kind === "mcp") {
        lookup.mcpNames.set(canonicalCapabilityName(capability.name), name);
      }
    }
  }

  return lookups;
}

export function explicitSkillUsage(
  externalId: string,
  name: unknown,
  occurredAt: string,
): CapabilityUsage | undefined {
  const safe = safeCanonicalName(name);
  return safe
    ? {
        externalId: `skill:${externalId}`,
        kind: "skill",
        name: safe,
        occurredAt,
      }
    : undefined;
}

interface McpUsageInput {
  externalId: string;
  toolName: unknown;
  namespace?: unknown;
  occurredAt: string;
}

function mcpName(toolName: unknown, namespace: unknown): string | undefined {
  if (typeof toolName === "string" && toolName.startsWith("mcp__")) {
    return toolName.split("__")[1];
  }
  if (typeof namespace === "string" && namespace.startsWith("mcp__")) {
    return namespace.split("__").at(-1);
  }
  return undefined;
}

export function mcpUsage({
  externalId,
  toolName,
  namespace,
  occurredAt,
}: McpUsageInput): CapabilityUsage | undefined {
  const name = safeCanonicalName(mcpName(toolName, namespace));
  return name
    ? { externalId: `mcp:${externalId}`, kind: "mcp", name, occurredAt }
    : undefined;
}

interface MatchedSkillReadsInput {
  externalId: string;
  toolName: unknown;
  input: unknown;
  occurredAt: string;
  lookup?: CapabilityLookup;
}

function stringLeaves(value: unknown, seen = new WeakSet<object>()): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  return Array.isArray(value)
    ? value.flatMap((item) => stringLeaves(item, seen))
    : Object.values(value).flatMap((item) => stringLeaves(item, seen));
}

function containsExactPath(value: string, path: string): boolean {
  let index = value.indexOf(path);
  while (index >= 0) {
    const before = value[index - 1];
    const after = value[index + path.length];
    if (
      (!before || PATH_START_BOUNDARY.test(before)) &&
      (!after || PATH_END_BOUNDARY.test(after))
    )
      return true;
    index = value.indexOf(path, index + path.length);
  }
  return false;
}

export function matchedSkillReads({
  externalId,
  toolName,
  input,
  occurredAt,
  lookup,
}: MatchedSkillReadsInput): CapabilityUsage[] {
  if (typeof toolName !== "string" || !READ_LIKE_TOOL.test(toolName)) return [];

  const leaves = stringLeaves(input);
  const nativeRead = toolName.toLowerCase() === "read";
  if (!nativeRead && !leaves.some((value) => READ_MARKER.test(value)))
    return [];

  const names = new Set<string>();
  for (const [path, name] of lookup?.skillFiles ?? []) {
    if (leaves.some((value) => containsExactPath(value, path))) names.add(name);
  }
  return [...names].map((name) => ({
    externalId: `skill-read:${externalId}:${name}`,
    kind: "skill",
    name,
    occurredAt,
  }));
}
