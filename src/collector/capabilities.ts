import type { AgentInventory } from "@/lib/agent-inventory";
import { canonicalCapabilityName } from "@/lib/agent-inventory/normalize";
import type { ZcodeStoredMessage, ZcodeToolUsage } from "@/lib/zcode-db";
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
const PATH_END_BOUNDARY = /[\s`;|&<>()]/;

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

function mcpConventionAlias(value: string): string {
  return canonicalCapabilityName(value).replace(/[- ]+/g, "_");
}

function addMcpAlias(
  candidates: Map<string, Map<string, string>>,
  alias: string,
  inventoryName: string,
): void {
  const key = safeCanonicalName(alias);
  if (!key) return;
  const targets = candidates.get(key) ?? new Map<string, string>();
  const canonicalTarget = canonicalCapabilityName(inventoryName);
  if (!targets.has(canonicalTarget))
    targets.set(canonicalTarget, inventoryName);
  candidates.set(key, targets);
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
  const mcpAliasCandidates = Object.fromEntries(
    agentProviders.map((provider) => [
      provider,
      new Map<string, Map<string, string>>(),
    ]),
  ) as Record<AgentProvider, Map<string, Map<string, string>>>;

  for (const inventory of inventories) {
    const lookup = lookups[inventory.provider];
    const mcpAliases = mcpAliasCandidates[inventory.provider];
    for (const capability of inventory.capabilities) {
      if (!ACTIVE_STATUSES.has(capability.status)) continue;
      const name =
        capability.kind === "mcp"
          ? safeName(capability.name)
          : safeCanonicalName(capability.name);
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
        addMcpAlias(mcpAliases, capability.name, name);
        addMcpAlias(mcpAliases, mcpConventionAlias(capability.name), name);
        const pluginName = capability.sourcePlugin?.split("@")[0];
        if (pluginName && safeName(pluginName)) {
          addMcpAlias(
            mcpAliases,
            `plugin_${pluginName}_${capability.name}`,
            name,
          );
        }
      }
    }
  }
  for (const provider of agentProviders) {
    for (const [alias, targets] of mcpAliasCandidates[provider]) {
      if (targets.size === 1)
        lookups[provider].mcpNames.set(alias, [...targets.values()][0]!);
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
  const timestamp = capabilityTimestamp(occurredAt);
  return safe && timestamp
    ? {
        externalId: `skill:${externalId}`,
        kind: "skill",
        name: safe,
        occurredAt: timestamp,
      }
    : undefined;
}

interface McpUsageInput {
  externalId: string;
  toolName: unknown;
  namespace?: unknown;
  occurredAt: string;
  lookup?: CapabilityLookup;
}

export function capabilityTimestamp(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return Number.isFinite(Date.parse(value)) ? value : undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
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
  lookup,
}: McpUsageInput): CapabilityUsage | undefined {
  const observedName = safeCanonicalName(mcpName(toolName, namespace));
  const name = observedName
    ? (lookup?.mcpNames.get(observedName) ?? observedName)
    : undefined;
  const timestamp = capabilityTimestamp(occurredAt);
  return name && safeName(name) && timestamp
    ? {
        externalId: `mcp:${externalId}`,
        kind: "mcp",
        name,
        occurredAt: timestamp,
      }
    : undefined;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

export function zcodeStoredCapabilityUsage(
  messages: ZcodeStoredMessage[],
  tools: ZcodeToolUsage[],
  lookup?: CapabilityLookup,
): CapabilityUsage[] {
  const skillUsage = messages.flatMap((message) =>
    message.parts.flatMap((part) => {
      const data = objectRecord(part.data);
      const state = objectRecord(data?.state);
      const input = objectRecord(state?.input);
      if (data?.type !== "tool" || data.tool !== "Skill") return [];
      const occurredAt = capabilityTimestamp(part.timeCreated);
      if (!occurredAt) return [];
      const usage = explicitSkillUsage(part.id, input?.skill, occurredAt);
      return usage ? [usage] : [];
    }),
  );
  const mcpToolUsage = tools.flatMap((tool) => {
    if (!tool.toolName.startsWith("mcp__")) return [];
    const occurredAt = capabilityTimestamp(tool.startedAt);
    if (!occurredAt) return [];
    const usage = mcpUsage({
      externalId: tool.toolCallId,
      toolName: tool.toolName,
      occurredAt,
      lookup,
    });
    return usage ? [usage] : [];
  });
  return [...skillUsage, ...mcpToolUsage];
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

interface QuoteState {
  quote?: '"' | "'";
  start?: number;
}

function quoteAt(value: string, end: number): QuoteState {
  let state: QuoteState = {};
  for (let index = 0; index < end; index += 1) {
    const character = value[index];
    if (state.quote === "'") {
      if (character === "'") state = {};
      continue;
    }
    if (state.quote === '"') {
      if (character === "\\") index += 1;
      else if (character === '"') state = {};
      continue;
    }
    if (character === "'" || character === '"') {
      state = { quote: character, start: index };
    } else if (character === "\\") {
      index += 1;
    }
  }
  return state;
}

function containsExactPath(value: string, path: string): boolean {
  let index = value.indexOf(path);
  while (index >= 0) {
    const quote = quoteAt(value, index);
    if (quote.quote) {
      const afterPath = index + path.length;
      const beforeQuote = value[(quote.start ?? index) - 1];
      const afterQuote = value[afterPath + 1];
      if (
        quote.start === index - 1 &&
        value[afterPath] === quote.quote &&
        (!beforeQuote || PATH_START_BOUNDARY.test(beforeQuote)) &&
        (!afterQuote || PATH_END_BOUNDARY.test(afterQuote))
      )
        return true;
    } else {
      const before = value[index - 1];
      const after = value[index + path.length];
      if (
        (!before || PATH_START_BOUNDARY.test(before)) &&
        (!after || PATH_END_BOUNDARY.test(after))
      )
        return true;
    }
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
  const timestamp = capabilityTimestamp(occurredAt);
  if (!timestamp) return [];

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
    occurredAt: timestamp,
  }));
}
