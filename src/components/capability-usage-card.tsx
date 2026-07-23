"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { relativeTime } from "@/lib/format";
import { providerBadges, providerLabels } from "@/lib/labels";
import type {
  CapabilitiesInsight,
  CapabilityInsight,
  UnusedCapabilityInsight,
} from "@/lib/queries";
import type { AgentProvider } from "@/lib/types";

interface CapabilityUsageCardProps {
  capabilities: CapabilitiesInsight;
}

type CapabilityTab = "skills" | "mcps" | "unused";

const providerBadgeClasses: Record<AgentProvider, string> = providerBadges;
const visibleRowCount = 8;
const tabs: { id: CapabilityTab; label: string }[] = [
  { id: "skills", label: "Skills" },
  { id: "mcps", label: "MCPs" },
  { id: "unused", label: "Unused" },
];

function parseTab(value: string | null): CapabilityTab {
  return value === "mcps" || value === "unused" ? value : "skills";
}

// Quantized fill/segment classes keep dynamic sizing out of inline styles.
function level(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.max(1, Math.round((value / max) * 10));
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
            ? "Never observed"
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
      <ul className="capability-panel-list">{children}</ul>
    </details>
  );
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
  const counts: Record<CapabilityTab, number> = {
    skills: skills.length,
    mcps: mcps.length,
    unused: capabilities.unused.length,
  };
  const segmentTotal = counts.skills + counts.mcps + counts.unused;
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

  function selectRange(range: CapabilitiesInsight["range"]) {
    replaceParams((params) => {
      if (range === "30d") params.delete("capabilityRange");
      else params.set("capabilityRange", range);
    });
  }

  function selectTab(tab: CapabilityTab) {
    replaceParams((params) => {
      if (tab === "skills") params.delete("capabilityTab");
      else params.set("capabilityTab", tab);
    });
  }

  const ladder = activeTab === "mcps" ? mcps : skills;
  const maxInvocations = ladder.reduce(
    (peak, item) => Math.max(peak, item.invocations),
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
        </div>
        <div className="capability-range" aria-label="Capability usage range">
          <button
            className="capability-range-option"
            type="button"
            aria-pressed={capabilities.range === "7d"}
            onClick={() => selectRange("7d")}
          >
            7 days
          </button>
          <button
            className="capability-range-option"
            type="button"
            aria-pressed={capabilities.range === "30d"}
            onClick={() => selectRange("30d")}
          >
            30 days
          </button>
        </div>
      </div>

      {segmentTotal > 0 ? (
        <div className="capability-segments" aria-hidden>
          {tabs.map(({ id }) =>
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
            <span aria-hidden className="capability-tab-key" />
            {label}
            <b>{counts[id]}</b>
          </button>
        ))}
      </div>

      {activeTab === "unused" ? (
        <div
          aria-labelledby="capability-tab-unused"
          id="capability-panel-unused"
          role="tabpanel"
        >
          {capabilities.unused.length === 0 ? (
            <p className="overview-empty">
              {hasCompleteCoverage
                ? "Every installed capability with complete coverage was observed in this range."
                : "No installed-but-unused results are available until a provider has complete coverage."}
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
                {capabilities.unused
                  .slice(visibleRowCount)
                  .map((capability) => (
                    <UnusedCapabilityRow
                      capability={capability}
                      key={`${capability.kind}:${capability.name}`}
                    />
                  ))}
              </Disclosure>
            </>
          )}
          {incompleteCoverage.length > 0 ? (
            <div className="capability-coverage" role="note">
              {incompleteCoverage.map(({ provider, state, message }) => (
                <p key={provider}>
                  {providerLabels[provider]} coverage {state}:{" "}
                  {message ??
                    "Installed-but-unused results omit this provider because its session history is incomplete."}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div
          aria-labelledby={`capability-tab-${activeTab}`}
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
                {ladder.slice(visibleRowCount).map((capability) => (
                  <UsedCapabilityRow
                    capability={capability}
                    key={`${capability.kind}:${capability.name}`}
                    max={maxInvocations}
                  />
                ))}
              </Disclosure>
            </>
          )}
        </div>
      )}
    </section>
  );
}
