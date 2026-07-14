import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import type { AgentProvider } from "@/lib/types";
import { canonicalCapabilityName, dedupeCapabilities } from "./normalize";
import type {
  AgentCapability,
  CapabilityOrigin,
  InstructionFile,
  InventoryWarning,
} from "./types";

export interface SkillLockEntry {
  source?: string;
  sourceType?: string;
  sourceUrl?: string;
}

export type SkillLock = Record<string, SkillLockEntry>;

export interface SkillDiscoveryContext {
  provider: AgentProvider;
  packaging?: AgentCapability["packaging"];
  origin?: CapabilityOrigin;
  sourcePlugin?: string;
  sourceRepository?: string;
  skillLock?: SkillLock;
  personalSkillRoots?: string[];
}

function warning(
  sourcePath: string,
  code: InventoryWarning["code"],
): InventoryWarning {
  return {
    sourcePath,
    code,
    message:
      code === "malformed"
        ? "Could not parse global provider configuration."
        : "Could not read global provider configuration.",
  };
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export async function readTextSource(
  sourcePath: string,
  warnings: InventoryWarning[],
): Promise<string | undefined> {
  try {
    return await readFile(sourcePath, "utf8");
  } catch (error) {
    if (!isMissing(error)) warnings.push(warning(sourcePath, "unreadable"));
    return undefined;
  }
}

export async function readJsonSource(
  sourcePath: string,
  warnings: InventoryWarning[],
): Promise<Record<string, unknown> | undefined> {
  const content = await readTextSource(sourcePath, warnings);
  if (content === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(content);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      warnings.push(warning(sourcePath, "malformed"));
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch {
    warnings.push(warning(sourcePath, "malformed"));
    return undefined;
  }
}

export async function readInstruction(
  sourcePath: string,
  warnings: InventoryWarning[],
): Promise<InstructionFile | undefined> {
  const content = await readTextSource(sourcePath, warnings);
  if (content === undefined) return undefined;
  return {
    filename: basename(sourcePath),
    sourcePath,
    content,
    contentFingerprint: createHash("sha256").update(content).digest("hex"),
  };
}

export async function readSkillLock(
  sourcePath: string,
  warnings: InventoryWarning[],
): Promise<SkillLock> {
  const parsed = await readJsonSource(sourcePath, warnings);
  const skills = parsed?.skills;
  if (!skills || typeof skills !== "object" || Array.isArray(skills)) return {};
  return Object.fromEntries(
    Object.entries(skills).filter(
      (entry): entry is [string, SkillLockEntry] =>
        typeof entry[1] === "object" && entry[1] !== null,
    ),
  );
}

function pathInside(path: string, root: string): boolean {
  const child = relative(resolve(root), resolve(path));
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function skillName(content: string, fallback: string): string {
  const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---/);
  const name = frontmatter?.[1].match(/^name:\s*["']?([^\n"']+)/m)?.[1];
  return name?.trim() || fallback;
}

function skillOrigin(
  name: string,
  canonicalPath: string,
  context: SkillDiscoveryContext,
): { origin: CapabilityOrigin; sourceRepository?: string } {
  if (canonicalPath.split(sep).includes(".system")) {
    return { origin: "built_in" };
  }
  const lock = context.skillLock?.[canonicalCapabilityName(name)];
  if (lock) {
    return { origin: "skills_sh", sourceRepository: lock.source };
  }
  if (
    context.personalSkillRoots?.some((root) => pathInside(canonicalPath, root))
  ) {
    return { origin: "personal" };
  }
  return {
    origin: context.origin ?? "unknown",
    sourceRepository: context.sourceRepository,
  };
}

async function capabilityFromSkillPath(
  sourcePath: string,
  context: SkillDiscoveryContext,
): Promise<AgentCapability | undefined> {
  const fallback = basename(sourcePath, extname(sourcePath));
  let canonicalSourcePath: string;
  try {
    canonicalSourcePath = await realpath(sourcePath);
  } catch {
    return {
      id: `${context.provider}:skill:${canonicalCapabilityName(fallback)}:${sourcePath}`,
      name: fallback,
      kind: "skill",
      status: "unavailable",
      packaging: context.packaging ?? "standalone",
      origin: context.origin ?? "unknown",
      sourcePlugin: context.sourcePlugin,
      sourceRepository: context.sourceRepository,
      sourcePath,
    };
  }

  const markdownPath =
    extname(canonicalSourcePath) === ".md"
      ? canonicalSourcePath
      : join(canonicalSourcePath, "SKILL.md");
  let content: string;
  try {
    content = await readFile(markdownPath, "utf8");
  } catch {
    return undefined;
  }
  const name = skillName(content, fallback);
  const provenance = skillOrigin(name, canonicalSourcePath, context);
  return {
    id: `${context.provider}:skill:${canonicalCapabilityName(name)}:${canonicalSourcePath}`,
    name,
    kind: "skill",
    status: "installed",
    packaging:
      provenance.origin === "built_in"
        ? "built_in"
        : (context.packaging ?? "standalone"),
    origin: provenance.origin,
    sourcePlugin: context.sourcePlugin,
    sourceRepository: provenance.sourceRepository,
    sourcePath,
    canonicalSourcePath,
  };
}

async function findSkillPaths(
  root: string,
  maxDepth: number,
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      paths.push(path);
      continue;
    }
    if (entry.isFile() && extname(entry.name) === ".md") {
      paths.push(path);
      continue;
    }
    if (!entry.isDirectory()) continue;
    try {
      await stat(join(path, "SKILL.md"));
      paths.push(path);
      continue;
    } catch {
      if (maxDepth > 0)
        paths.push(...(await findSkillPaths(path, maxDepth - 1)));
    }
  }
  return paths;
}

export async function discoverSkillRoots(
  roots: string[],
  context: SkillDiscoveryContext,
): Promise<AgentCapability[]> {
  const personalSkillRoots = await Promise.all(
    (context.personalSkillRoots ?? []).map(async (root) => {
      try {
        return await realpath(root);
      } catch {
        return resolve(root);
      }
    }),
  );
  const normalizedContext = { ...context, personalSkillRoots };
  const paths = (
    await Promise.all(roots.map((root) => findSkillPaths(root, 5)))
  ).flat();
  const capabilities = await Promise.all(
    paths.map((path) => capabilityFromSkillPath(path, normalizedContext)),
  );
  return dedupeCapabilities(
    capabilities.filter(
      (capability): capability is AgentCapability => capability !== undefined,
    ),
  );
}

export function capability(
  provider: AgentProvider,
  kind: AgentCapability["kind"],
  name: string,
  fields: Partial<AgentCapability> = {},
): AgentCapability {
  return {
    id: `${provider}:${kind}:${canonicalCapabilityName(name)}:${fields.sourcePath ?? "configured"}`,
    name,
    kind,
    status: "installed",
    packaging: "standalone",
    origin: "unknown",
    ...fields,
  };
}

export async function discoverPluginMcps(
  provider: AgentProvider,
  pluginRoot: string,
  pluginName: string,
  status: "enabled" | "disabled",
  warnings: InventoryWarning[],
): Promise<AgentCapability[]> {
  const manifestPaths = [
    join(pluginRoot, ".mcp.json"),
    join(pluginRoot, ".claude-plugin", "plugin.json"),
    join(pluginRoot, "plugin.json"),
  ];
  const names = new Set<string>();
  for (const manifestPath of manifestPaths) {
    const manifest = await readJsonSource(manifestPath, warnings);
    if (!manifest) continue;
    const configured = objectValue(manifest.mcpServers);
    const servers =
      configured ?? (basename(manifestPath) === ".mcp.json" ? manifest : {});
    for (const name of Object.keys(servers)) names.add(name);
  }
  return [...names].map((name) =>
    capability(provider, "mcp", name, {
      status,
      packaging: "plugin",
      origin: "marketplace",
      sourcePlugin: pluginName,
      sourcePath: pluginRoot,
    }),
  );
}

export function objectValue(
  value: unknown,
): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function safeAbsolutePath(value: unknown): string | undefined {
  return typeof value === "string" && isAbsolute(value) ? value : undefined;
}

export async function listExtensionFiles(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        [".ts", ".js", ".mjs", ".cjs"].includes(extname(entry.name)),
    )
    .map((entry) => join(root, entry.name));
}

export async function isPathPresent(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}
