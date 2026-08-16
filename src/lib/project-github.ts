import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

interface ProjectGitHubDependencies {
  findRoot?: (workdir: string) => string | null;
  readOrigin?: (gitRoot: string) => string | null;
}

const REMOTE_PART = /^[A-Za-z0-9_.-]+$/;

export function findGitRoot(cwd: string): string | null {
  let current = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function canonicalGitHubUrl(owner: string, repository: string): string | null {
  const name = repository.endsWith(".git")
    ? repository.slice(0, -4)
    : repository;
  if (!REMOTE_PART.test(owner) || !REMOTE_PART.test(name)) return null;
  return `https://github.com/${owner}/${name}`;
}

export function normalizeGitHubRemote(remote: string): string | null {
  const value = remote.trim();
  const scpMatch = /^git@github\.com:([^/]+)\/([^/]+)\/?$/.exec(value);
  if (scpMatch) return canonicalGitHubUrl(scpMatch[1], scpMatch[2]);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.hostname.toLowerCase() !== "github.com" || url.search || url.hash)
    return null;
  if (url.protocol === "https:") {
    if (url.username || url.password || url.port) return null;
  } else if (url.protocol === "ssh:") {
    if (url.username !== "git" || url.password || url.port) return null;
  } else {
    return null;
  }
  const pathMatch = /^\/([^/]+)\/([^/]+)\/?$/.exec(url.pathname);
  return pathMatch ? canonicalGitHubUrl(pathMatch[1], pathMatch[2]) : null;
}

function readOriginRemote(gitRoot: string): string | null {
  try {
    return execFileSync(
      "git",
      ["-C", gitRoot, "config", "--get", "remote.origin.url"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1_000,
      },
    ).trim();
  } catch {
    return null;
  }
}

export function resolveProjectGitHubUrl(
  workdirs: string[],
  dependencies: ProjectGitHubDependencies = {},
): string | null {
  if (!workdirs.length) return null;
  const findRoot = dependencies.findRoot ?? findGitRoot;
  const readOrigin = dependencies.readOrigin ?? readOriginRemote;
  const roots = new Set<string>();
  for (const workdir of workdirs) {
    const root = findRoot(workdir);
    if (!root) return null;
    roots.add(root);
  }

  const urls = new Set<string>();
  for (const root of roots) {
    const remote = readOrigin(root);
    if (!remote) return null;
    const url = normalizeGitHubRemote(remote);
    if (!url) return null;
    urls.add(url);
  }
  return urls.size === 1 ? [...urls][0] : null;
}
