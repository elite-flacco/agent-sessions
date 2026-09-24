import type { ProjectCostSummary } from "@/lib/queries";

/**
 * Open pull-request counts are live GitHub state, not session evidence, so —
 * like agent inventories — they are looked up at read time and never persisted.
 * Counts come from one request per repository: `per_page=1` returns a single
 * pull request plus a `Link` header whose `rel="last"` page number is the open
 * count, so repositories with hundreds of PRs cost the same as empty ones.
 */

const COUNT_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 2_500;

interface CacheEntry {
  expiresAt: number;
  count: number | null;
}

const countCache = new Map<string, CacheEntry>();

interface PullRequestCountDependencies {
  fetch?: typeof fetch;
  now?: () => number;
}

function parseLastPage(linkHeader: string | null): number | null {
  if (!linkHeader) return null;
  const match = /(?:^|,)\s*<[^>]*[?&]page=(\d+)[^>]*>\s*;\s*rel="last"/.exec(
    linkHeader,
  );
  return match ? Number.parseInt(match[1], 10) : null;
}

async function fetchOpenCount(
  githubUrl: string,
  dependencies: PullRequestCountDependencies,
): Promise<number | null> {
  const ownerRepository = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(
    githubUrl,
  );
  if (!ownerRepository) return null;
  const token = process.env.GITHUB_TOKEN;
  try {
    const response = await (dependencies.fetch ?? fetch)(
      `https://api.github.com/repos/${ownerRepository[1]}/${ownerRepository[2]}/pulls?state=open&per_page=1`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok) return null;
    const pulls = (await response.json()) as unknown[];
    if (!Array.isArray(pulls)) return null;
    // With per_page=1 the Link header's last page is the total when there is
    // more than one page; without it the items themselves are the whole list.
    const lastPage = parseLastPage(response.headers.get("Link"));
    return lastPage ?? pulls.length;
  } catch {
    return null;
  }
}

async function cachedOpenCount(
  githubUrl: string,
  dependencies: PullRequestCountDependencies,
): Promise<number | null> {
  const now = dependencies.now ?? Date.now;
  const cached = countCache.get(githubUrl);
  if (cached && cached.expiresAt > now()) return cached.count;
  const count = await fetchOpenCount(githubUrl, dependencies);
  countCache.set(githubUrl, {
    count,
    // Failed lookups cache too, so a polling dashboard cannot hammer a
    // rate-limited or unreachable API — the count simply stays hidden.
    expiresAt: now() + COUNT_TTL_MS,
  });
  return count;
}

/**
 * Live open-PR counts for project cards. Queries stay SQLite-only, so the
 * projects page enriches summaries with this the same way insights receives
 * agent inventories: after the read boundary, before the view.
 */
export async function attachOpenPullRequestCounts(
  projects: ProjectCostSummary[],
  dependencies: PullRequestCountDependencies = {},
): Promise<ProjectCostSummary[]> {
  const urls = [
    ...new Set(projects.map((project) => project.githubUrl).filter(isString)),
  ];
  const counts = new Map(
    await Promise.all(
      urls.map(async (url): Promise<[string, number | null]> => [
        url,
        await cachedOpenCount(url, dependencies),
      ]),
    ),
  );
  return projects.map((project) => ({
    ...project,
    openPullRequestCount: project.githubUrl
      ? (counts.get(project.githubUrl) ?? null)
      : null,
  }));
}

function isString(value: string | null): value is string {
  return value != null;
}

/** Resets the live-count cache; exists so tests start from a cold cache. */
export function clearPullRequestCountCache(): void {
  countCache.clear();
}
