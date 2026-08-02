"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { relativeTime } from "@/lib/format";
import { providerBadges, providerLabels } from "@/lib/labels";
import type {
  CapabilitiesInsight,
  CapabilityCoverage,
  CapabilityInsight,
  UnusedCapabilityInsight,
} from "@/lib/queries";
import { type AgentProvider, agentProviders } from "@/lib/types";

interface CapabilityUsageCardProps {
  capabilities: CapabilitiesInsight;
}

type CapabilityTab = "skills" | "mcps" | "providers" | "unused";

const providerBadgeClasses: Record<AgentProvider, string> = providerBadges;
const visibleRowCount = 8;
// Only the three counted tabs feed the segmented bar; "By provider" is a
// second view of the same usage, not a fourth bucket of capabilities.
const tabs: { id: CapabilityTab; label: string }[] = [
  { id: "skills", label: "Skills" },
  { id: "mcps", label: "MCPs" },
  { id: "unused", label: "Unused" },
  { id: "providers", label: "By provider" },
];
const countedTabs = ["skills", "mcps", "unused"] as const;

function parseTab(value: string | null): CapabilityTab {
  return value === "mcps" || value === "unused" || value === "providers"
    ? value
    : "skills";
}

// Quantized fill/segment classes keep dynamic sizing out of inline styles.
function level(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.max(1, Math.round((value / max) * 10));
}

// Heat cells span three orders of magnitude — a busy MCP server runs into the
// hundreds while most skills sit in single digits — and a heat ramp only has a
// handful of steps. Linear shading would paint every row but one the same
// shade, so cells are ranked on a log scale.
function heatLevel(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.max(
    1,
    Math.round((Math.log(value + 1) / Math.log(max + 1)) * 10),
  );
}

function ProviderBadges({ providers }: { providers: AgentProvider[] }) {
  return providers.map((provider) => (
    <span className={`badge ${providerBadgeClasses[provider]}`} key={provider}>
      {providerLabels[provider]}
    </span>
  ));
}

// Each tab scales against its own peak. A skill invocation is a whole
// workflow and an MCP invocation is a single tool call, so a shared scale
// isn't a real comparison — it just flattens the skills ladder against the
// far larger MCP counts.
function UsedCapabilityRow({
  capability,
  max,
}: {
  capability: CapabilityInsight;
  max: number;
}) {
  const useLabel = capability.invocations === 1 ? "use" : "uses";
  const sessionLabel = capability.sessionCount === 1 ? "session" : "sessions";
  const detail = `${capability.invocations} ${useLabel} · ${capability.sessionCount} ${sessionLabel} · last used ${relativeTime(capability.lastUsedAt)}`;

  return (
    <li className="capability-ladder-row">
      <span className="capability-name" title={capability.name}>
        {capability.name}
      </span>
      <span
        aria-hidden
        className={`meter capability-meter is-${capability.kind}`}
        title={detail}
      >
        <i className={`meter-fill-${level(capability.invocations, max)}`} />
      </span>
      <span className="capability-bar-value">{capability.invocations}</span>
      <span className="capability-ladder-meta">
        {capability.sessionCount} {sessionLabel} ·{" "}
        {relativeTime(capability.lastUsedAt)}
        <ProviderBadges providers={capability.providers} />
      </span>
    </li>
  );
}

function UnusedCapabilityRow({
  capability,
}: {
  capability: UnusedCapabilityInsight;
}) {
  return (
    <li className="capability-unused-row">
      <span className="capability-name">{capability.name}</span>
      <span className="capability-usage-meta">
        <span className="badge badge-5">
          {capability.kind === "skill" ? "Skill" : "MCP"}
        </span>
        <span>
          {capability.neverObserved || capability.lastUsedAt === null
            ? "No recorded use in available history"
            : `Last used ${relativeTime(capability.lastUsedAt)}`}
        </span>
        <ProviderBadges providers={capability.providers} />
      </span>
    </li>
  );
}

function Disclosure({
  hidden,
  children,
}: {
  hidden: number;
  children: React.ReactNode;
}) {
  if (hidden === 0) return null;
  return (
    <details className="capability-more">
      <summary>Show {hidden} more</summary>
      {children}
    </details>
  );
}

// Rows are capabilities, columns are providers. A provider whose coverage is
// incomplete gets a hatched cell rather than an empty one: Relay cannot tell
// "never called it" from "never saw the session".
function ProviderGridRows({
  capabilities,
  coverage,
  max,
}: {
  capabilities: CapabilityInsight[];
  coverage: Map<AgentProvider, CapabilityCoverage["state"]>;
  max: number;
}) {
  return capabilities.map((capability) => (
    <tr key={`${capability.kind}:${capability.name}`}>
      <th scope="row">
        <span className="capability-grid-name">
          <span className={`capability-kind-dot is-${capability.kind}`} />
          <span className="capability-name" title={capability.name}>
            {capability.name}
          </span>
        </span>
      </th>
      {agentProviders.map((provider) => {
        const invocations = capability.byProvider[provider] ?? 0;
        const unknown = coverage.get(provider) !== "complete" && !invocations;
        return (
          <td key={provider}>
            <span
              className={
                unknown
                  ? "capability-cell is-unknown"
                  : `capability-cell heat-fill-${heatLevel(invocations, max)}`
              }
              title={
                unknown
                  ? `${providerLabels[provider]}: coverage incomplete`
                  : `${providerLabels[provider]}: ${invocations}`
              }
            />
          </td>
        );
      })}
      <td className="capability-bar-value">{capability.invocations}</td>
    </tr>
  ));
}

export function CapabilityUsageCard({
  capabilities,
}: CapabilityUsageCardProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = parseTab(searchParams.get("capabilityTab"));

  const skills = capabilities.used.filter((item) => item.kind === "skill");
  const mcps = capabilities.used.filter((item) => item.kind === "mcp");
  const counts: Record<(typeof countedTabs)[number], number> = {
    skills: skills.length,
    mcps: mcps.length,
    unused: capabilities.unused.length,
  };
  const segmentTotal = counts.skills + counts.mcps + counts.unused;
  const coverageByProvider = new Map(
    capabilities.coverage.map(({ provider, state }) => [provider, state]),
  );
  const incompleteCoverage = capabilities.coverage.filter(
    ({ state }) => state !== "complete",
  );
  const hasCompleteCoverage = capabilities.coverage.some(
    ({ state }) => state === "complete",
  );

  function replaceParams(update: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    update(params);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }

  function selectTab(tab: CapabilityTab) {
    replaceParams((params) => {
      if (tab === "skills") params.delete("capabilityTab");
      else params.set("capabilityTab", tab);
    });
  }

  const ladder = activeTab === "mcps" ? mcps : skills;
  const peak = (items: CapabilityInsight[]) =>
    items.reduce((highest, item) => Math.max(highest, item.invocations), 0);
  const maxInvocations = peak(ladder);
  // `used` arrives grouped by kind for the ladder tabs; the grid mixes both
  // kinds, so it needs one ranking across all of them.
  const gridRows = [...capabilities.used].sort(
    (left, right) =>
      right.invocations - left.invocations ||
      left.name.localeCompare(right.name),
  );
  // The grid's cell scale is per-provider, so it takes the largest single
  // provider contribution rather than the largest total.
  const maxCell = capabilities.used.reduce(
    (highest, item) => Math.max(highest, ...Object.values(item.byProvider), 0),
    0,
  );
  const rangeLabel = capabilities.range === "7d" ? "7 days" : "30 days";

  return (
    <section
      className="card insight-card capability-insight"
      aria-labelledby="capability-insight-title"
    >
      <div className="capability-insight-head">
        <div>
          <h3 id="capability-insight-title">Capability adoption</h3>
          {capabilities.installedCount > 0 ? (
            <p className="capability-headline">
              {capabilities.installedUsedCount}
              <small>
                {" "}
                of {capabilities.installedCount} installed capabilities used ·{" "}
                {rangeLabel}
              </small>
            </p>
          ) : (
            <p className="capability-headline">
              {capabilities.used.length}
              <small> capabilities used · {rangeLabel}</small>
            </p>
          )}
          <p className="capability-evidence-note">
            Used means Relay recorded at least one matching call in the selected
            period. Unused means installed but no matching call was recorded in
            that period. Results include only providers with complete scan
            coverage.
          </p>
        </div>
      </div>

      {segmentTotal > 0 ? (
        <div className="capability-segments" aria-hidden>
          {countedTabs.map((id) =>
            counts[id] === 0 ? null : (
              <span
                className={`capability-segment is-${id} capability-seg-${level(counts[id], segmentTotal)}${activeTab === id ? "" : " is-dim"}`}
                key={id}
              />
            ),
          )}
        </div>
      ) : null}

      <div className="capability-tabs" role="tablist">
        {tabs.map(({ id, label }) => (
          <button
            aria-controls={`capability-panel-${id}`}
            aria-selected={activeTab === id}
            className={`capability-tab is-${id}`}
            id={`capability-tab-${id}`}
            key={id}
            onClick={() => selectTab(id)}
            role="tab"
            type="button"
          >
            {id === "providers" ? null : (
              <span aria-hidden className="capability-tab-key" />
            )}
            {label}
            {id === "providers" ? null : (
              <b>{counts[id as (typeof countedTabs)[number]]}</b>
            )}
          </button>
        ))}
      </div>

      {activeTab === "providers" ? (
        <div
          aria-labelledby="capability-tab-providers"
          className="capability-panel"
          id="capability-panel-providers"
          role="tabpanel"
        >
          {capabilities.used.length === 0 ? (
            <p className="overview-empty">
              No capability usage observed in this range.
            </p>
          ) : (
            <>
              <div className="capability-grid-scroll">
                <table className="capability-grid">
                  <caption className="sr-only">
                    Capability invocations per provider, most used first
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Capability</th>
                      {agentProviders.map((provider) => (
                        <th key={provider} scope="col">
                          {providerLabels[provider]}
                        </th>
                      ))}
                      <th scope="col">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <ProviderGridRows
                      capabilities={gridRows.slice(0, visibleRowCount)}
                      coverage={coverageByProvider}
                      max={maxCell}
                    />
                  </tbody>
                </table>
              </div>
              <Disclosure
                hidden={Math.max(0, gridRows.length - visibleRowCount)}
              >
                <div className="capability-grid-scroll">
                  <table className="capability-grid">
                    <tbody>
                      <ProviderGridRows
                        capabilities={gridRows.slice(visibleRowCount)}
                        coverage={coverageByProvider}
                        max={maxCell}
                      />
                    </tbody>
                  </table>
                </div>
              </Disclosure>
              <div className="capability-legend">
                <span>
                  Less
                  <i className="capability-cell heat-fill-0" />
                  <i className="capability-cell heat-fill-3" />
                  <i className="capability-cell heat-fill-6" />
                  <i className="capability-cell heat-fill-10" />
                  More
                </span>
                {incompleteCoverage.length > 0 ? (
                  <span>
                    <i className="capability-cell is-unknown" />
                    coverage incomplete
                  </span>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : activeTab === "unused" ? (
        <div
          aria-labelledby="capability-tab-unused"
          className="capability-panel"
          id="capability-panel-unused"
          role="tabpanel"
        >
          {capabilities.unused.length === 0 ? (
            <p className="overview-empty">
              {hasCompleteCoverage
                ? "Every installed capability with complete coverage was used in this range."
                : "No unused results are available until a provider has complete coverage."}
            </p>
          ) : (
            <>
              <ul className="capability-panel-list">
                {capabilities.unused
                  .slice(0, visibleRowCount)
                  .map((capability) => (
                    <UnusedCapabilityRow
                      capability={capability}
                      key={`${capability.kind}:${capability.name}`}
                    />
                  ))}
              </ul>
              <Disclosure
                hidden={Math.max(
                  0,
                  capabilities.unused.length - visibleRowCount,
                )}
              >
                <ul className="capability-panel-list">
                  {capabilities.unused
                    .slice(visibleRowCount)
                    .map((capability) => (
                      <UnusedCapabilityRow
                        capability={capability}
                        key={`${capability.kind}:${capability.name}`}
                      />
                    ))}
                </ul>
              </Disclosure>
            </>
          )}
          {incompleteCoverage.length > 0 ? (
            <div className="capability-coverage" role="note">
              {incompleteCoverage.map(({ provider, state, message }) => (
                <p key={provider}>
                  {providerLabels[provider]} coverage {state}:{" "}
                  {message ??
                    "Unused results omit this provider because its session history is incomplete."}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div
          aria-labelledby={`capability-tab-${activeTab}`}
          className="capability-panel"
          id={`capability-panel-${activeTab}`}
          role="tabpanel"
        >
          {ladder.length === 0 ? (
            <p className="overview-empty">
              {activeTab === "mcps"
                ? "No MCP usage observed in this range."
                : "No skill usage observed in this range."}
            </p>
          ) : (
            <>
              <ul className="capability-panel-list">
                {ladder.slice(0, visibleRowCount).map((capability) => (
                  <UsedCapabilityRow
                    capability={capability}
                    key={`${capability.kind}:${capability.name}`}
                    max={maxInvocations}
                  />
                ))}
              </ul>
              <Disclosure hidden={Math.max(0, ladder.length - visibleRowCount)}>
                <ul className="capability-panel-list">
                  {ladder.slice(visibleRowCount).map((capability) => (
                    <UsedCapabilityRow
                      capability={capability}
                      key={`${capability.kind}:${capability.name}`}
                      max={maxInvocations}
                    />
                  ))}
                </ul>
              </Disclosure>
            </>
          )}
        </div>
      )}
    </section>
  );
}
