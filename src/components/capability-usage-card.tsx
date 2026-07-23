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

const providerBadgeClasses: Record<AgentProvider, string> = providerBadges;
const visibleUnusedCount = 8;

function ProviderBadges({ providers }: { providers: AgentProvider[] }) {
  return providers.map((provider) => (
    <span className={`badge ${providerBadgeClasses[provider]}`} key={provider}>
      {providerLabels[provider]}
    </span>
  ));
}

function UsedCapabilityRow({ capability }: { capability: CapabilityInsight }) {
  const useLabel = capability.invocations === 1 ? "use" : "uses";
  const sessionLabel = capability.sessionCount === 1 ? "session" : "sessions";

  return (
    <li className="capability-usage-row">
      <strong className="capability-name">{capability.name}</strong>
      <div className="capability-usage-meta">
        <span>
          {capability.invocations} {useLabel} · {capability.sessionCount}{" "}
          {sessionLabel}
        </span>
        <span aria-hidden>·</span>
        <span>{relativeTime(capability.lastUsedAt)}</span>
        <ProviderBadges providers={capability.providers} />
      </div>
    </li>
  );
}

function RankedCapabilities({
  capabilities,
  emptyLabel,
}: {
  capabilities: CapabilityInsight[];
  emptyLabel: string;
}) {
  if (capabilities.length === 0) {
    return <p className="overview-empty">{emptyLabel}</p>;
  }

  return (
    <ol className="capability-usage-list">
      {capabilities.map((capability) => (
        <UsedCapabilityRow
          capability={capability}
          key={`${capability.kind}:${capability.name}`}
        />
      ))}
    </ol>
  );
}

function UnusedCapabilityRow({
  capability,
}: {
  capability: UnusedCapabilityInsight;
}) {
  return (
    <div className="capability-usage-row">
      <strong className="capability-name">{capability.name}</strong>
      <div className="capability-usage-meta">
        <span className="badge badge-5">
          {capability.kind === "skill" ? "Skill" : "MCP"}
        </span>
        <span>
          {capability.neverObserved || capability.lastUsedAt === null
            ? "Never observed in available history"
            : `Last used ${relativeTime(capability.lastUsedAt)}`}
        </span>
        <ProviderBadges providers={capability.providers} />
      </div>
    </div>
  );
}

export function CapabilityUsageCard({
  capabilities,
}: CapabilityUsageCardProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const skills = capabilities.mostUsed.filter(
    (capability) => capability.kind === "skill",
  );
  const mcps = capabilities.mostUsed.filter(
    (capability) => capability.kind === "mcp",
  );
  const visibleUnused = capabilities.unused.slice(0, visibleUnusedCount);
  const additionalUnused = capabilities.unused.slice(visibleUnusedCount);
  const incompleteCoverage = capabilities.coverage.filter(
    ({ state }) => state !== "complete",
  );
  const hasCompleteCoverage = capabilities.coverage.some(
    ({ state }) => state === "complete",
  );

  function selectRange(range: CapabilitiesInsight["range"]) {
    const params = new URLSearchParams(searchParams.toString());
    if (range === "30d") params.delete("capabilityRange");
    else params.set("capabilityRange", range);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <section
      className="card insight-card capability-insight"
      aria-labelledby="capability-insight-title"
    >
      <div className="capability-insight-head">
        <div>
          <h3 id="capability-insight-title">Skills &amp; MCP usage</h3>
          <p className="insight-sub">
            Observed capability calls across coding agents
          </p>
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

      <div className="capability-usage-columns">
        <section>
          <h4>Most-used skills</h4>
          <RankedCapabilities
            capabilities={skills}
            emptyLabel="No skill usage observed in this range."
          />
        </section>
        <section>
          <h4>Most-used MCPs</h4>
          <RankedCapabilities
            capabilities={mcps}
            emptyLabel="No MCP usage observed in this range."
          />
        </section>
      </div>

      <section className="capability-unused">
        <h4>Installed but unused</h4>
        {capabilities.unused.length === 0 ? (
          <p className="overview-empty">
            {hasCompleteCoverage
              ? "Every installed capability with complete coverage was observed in this range."
              : "No installed-but-unused results are available until a provider has complete coverage."}
          </p>
        ) : (
          <div className="capability-usage-list">
            {visibleUnused.map((capability) => (
              <UnusedCapabilityRow
                capability={capability}
                key={`${capability.kind}:${capability.name}`}
              />
            ))}
            {additionalUnused.length > 0 ? (
              <details className="capability-unused-more">
                <summary>
                  Show all {capabilities.unused.length} unused capabilities
                </summary>
                <div className="capability-usage-list">
                  {additionalUnused.map((capability) => (
                    <UnusedCapabilityRow
                      capability={capability}
                      key={`${capability.kind}:${capability.name}`}
                    />
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        )}
      </section>

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
    </section>
  );
}
