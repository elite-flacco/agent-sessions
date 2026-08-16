import {
  AlertTriangle,
  Check,
  CircleSlash2,
  CircleX,
  Minus,
} from "lucide-react";
import Link from "next/link";
import {
  buildComparisonRows,
  findComparisonDuplicates,
  type AgentInventory,
  type ComparisonAssessmentReason,
  type ComparisonDuplicate,
  type ComparisonRow,
  type InventoryWarning,
} from "@/lib/agent-inventory";
import { shortenHomePath } from "@/lib/format";
import { providerLabels } from "@/lib/labels";
import { agentProviders } from "@/lib/types";
import { ProviderBadge } from "../provider-badge";
import type { AgentSetupFilters } from "./filters";
import { setupHref } from "./filters";
import {
  capabilityKindLabels,
  capabilitySourceLabel,
  kindIcons,
  kindMarkers,
  originLabels,
  statusBadges,
  statusLabels,
} from "./meta";

const comparisonKindSortOrder: Record<ComparisonRow["kind"], number> = {
  plugin: 0,
  skill: 1,
  mcp: 2,
  instruction: 3,
};

const assessmentOrder = { fix: 0, review: 1, context: 2 } as const;

/**
 * Review sections in the Needs Attention view, most actionable first. Each
 * reason has a different remedy — reinstall from one source, reconcile config,
 * install the missing copy — so they must not read as one list. Reasons absent
 * here (the Fix-level ones, plus `provider_specific`/`consistent`) never reach
 * a review section.
 */
const reviewSections: readonly {
  reason: ComparisonAssessmentReason;
  label: string;
}[] = [
  { reason: "content_drift", label: "Reviews · Different content" },
  {
    reason: "configuration_drift",
    label: "Reviews · Different configuration",
  },
  { reason: "instruction_drift", label: "Reviews · Instruction drift" },
  {
    reason: "missing_from_one_provider",
    label: "Reviews · Missing from one agent",
  },
];

export function filteredComparisonRows(
  inventories: AgentInventory[],
  filters: AgentSetupFilters,
): ComparisonRow[] {
  let rows = buildComparisonRows(inventories);
  if (filters.q) {
    const query = filters.q.toLocaleLowerCase();
    rows = rows.filter((row) => row.name.toLocaleLowerCase().includes(query));
  }
  if (filters.kind) rows = rows.filter((row) => row.kind === filters.kind);
  if (filters.status) {
    rows = rows.filter((row) =>
      Object.values(row.cells).some(
        (capability) => capability.status === filters.status,
      ),
    );
  }
  return rows;
}

export function ComparisonView({
  inventories,
  filters,
}: {
  inventories: AgentInventory[];
  filters: AgentSetupFilters;
}) {
  let rows = filteredComparisonRows(inventories, filters);
  // No provider narrowing here — see FilterForm: Compare always spans every
  // provider so drift stays visible.
  if (filters.comparisonMode === "attention") {
    rows = rows
      .filter((row) => row.assessment.level !== "context")
      .sort(
        (left, right) =>
          assessmentOrder[left.assessment.level] -
            assessmentOrder[right.assessment.level] ||
          comparisonKindSortOrder[left.kind] -
            comparisonKindSortOrder[right.kind] ||
          left.name.localeCompare(right.name),
      );
  } else if (filters.discrepanciesOnly) {
    rows = rows.filter((row) => row.isDiscrepancy);
  }

  const duplicates =
    filters.comparisonMode === "attention"
      ? findComparisonDuplicates(inventories)
      : [];
  // Warnings mean the inventory itself may be incomplete (malformed config,
  // stale artifacts) — the highest-severity condition the discovery layer can
  // report, so the attention view leads with them. Shared-source warnings
  // (e.g. the skills.sh lockfile) repeat on every provider; dedupe by content.
  const attentionWarnings =
    filters.comparisonMode === "attention"
      ? [
          ...new Map(
            inventories
              .flatMap((inventory) => inventory.warnings)
              .map(
                (warning) =>
                  [
                    `${warning.sourcePath}:${warning.code}:${warning.message}`,
                    warning,
                  ] as const,
              ),
          ).values(),
        ]
      : [];

  // Fixes share one section — they are all "this is broken, repair it".
  // Reviews are judgement calls whose remedy depends entirely on the cause, so
  // each reason gets its own section rather than one undifferentiated pile.
  const comparisonGroups = filters.comparisonMode
    ? [
        {
          id: "fix",
          level: "fix",
          label: "Fixes",
          rows: rows.filter((row) => row.assessment.level === "fix"),
        },
        ...reviewSections.map((section) => ({
          id: `review:${section.reason}`,
          level: "review",
          label: section.label,
          rows: rows.filter(
            (row) =>
              row.assessment.level === "review" &&
              row.assessment.reason === section.reason,
          ),
        })),
      ].filter((group) => group.rows.length > 0)
    : [{ id: "all", level: "all", label: undefined, rows }];

  return (
    <>
      <div className="agent-comparison-toolbar">
        <nav className="agent-comparison-switcher" aria-label="Comparison mode">
          <Link
            href={setupHref(filters, {
              comparisonMode: "attention",
              discrepanciesOnly: undefined,
            })}
            className={
              filters.comparisonMode === "attention"
                ? "agent-comparison-tab agent-comparison-tab-active"
                : "agent-comparison-tab"
            }
            aria-current={
              filters.comparisonMode === "attention" ? "page" : undefined
            }
          >
            Needs attention
          </Link>
          <Link
            href={setupHref(filters, {
              comparisonMode: undefined,
              discrepanciesOnly: undefined,
            })}
            className={
              filters.comparisonMode
                ? "agent-comparison-tab"
                : "agent-comparison-tab agent-comparison-tab-active"
            }
            aria-current={filters.comparisonMode ? undefined : "page"}
          >
            Complete matrix
          </Link>
        </nav>
      </div>

      {attentionWarnings.length > 0 ? (
        <section className="card agent-provider-section">
          <header className="agent-provider-heading">
            <div>
              <strong>Configuration warnings</strong>
            </div>
            <span className="text-muted-foreground">
              Discovery could not fully trust these sources
            </span>
          </header>
          <div className="agent-warning-list">
            {attentionWarnings.map((warning: InventoryWarning) => (
              <div
                key={`${warning.sourcePath}:${warning.code}:${warning.message}`}
                className="notice"
              >
                <AlertTriangle size={14} />
                <span>{warning.message}</span>
                <code>{warning.sourcePath}</code>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {/* Warnings and duplicates are both agent-local inventory hygiene: short,
          high-severity, and fixable without consulting the other agents. They
          lead together, ahead of the long cross-agent matrix. */}
      {duplicates.length > 0 ? (
        <DuplicatesSection duplicates={duplicates} />
      ) : null}
      {rows.length === 0 ? (
        <div className="card empty-state agent-empty-state">
          <h3>
            {filters.comparisonMode === "attention"
              ? "No consensus drift needs attention."
              : "No comparison rows match these filters."}
          </h3>
          <p>
            {filters.comparisonMode === "attention"
              ? "The current setup has no Fix or Review items for these filters."
              : "Adjust the filters or include matching configurations."}
          </p>
          {filters.comparisonMode === "attention" ? (
            <Link
              className="btn btn-outline"
              href={setupHref(filters, { comparisonMode: undefined })}
            >
              Complete matrix
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="card agent-comparison-region" tabIndex={0}>
          <table className="agent-comparison-table">
            <colgroup>
              <col className="agent-comparison-capability-column" />
              {agentProviders.map((provider) => (
                <col
                  className="agent-comparison-provider-column"
                  key={provider}
                />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Capability</th>
                {agentProviders.map((provider) => (
                  <th scope="col" key={provider}>
                    {providerLabels[provider]}
                  </th>
                ))}
              </tr>
            </thead>
            {comparisonGroups.map((group) => (
              <tbody key={group.id}>
                {group.label ? (
                  <tr
                    className={`agent-comparison-group-row agent-comparison-group-${group.level}`}
                  >
                    <th scope="rowgroup" colSpan={agentProviders.length + 1}>
                      <span>{group.label}</span>
                      <span>{group.rows.length}</span>
                    </th>
                  </tr>
                ) : null}
                {group.rows.map((row) => (
                  <ComparisonTableRow
                    key={row.key}
                    row={row}
                    showAssessment={filters.comparisonMode === "attention"}
                  />
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </>
  );
}

function DuplicatesSection({
  duplicates,
}: {
  duplicates: ComparisonDuplicate[];
}) {
  return (
    <section className="card agent-provider-section">
      <header className="agent-provider-heading">
        <div>
          <strong>Duplicate installs</strong>
        </div>
        <span className="text-muted-foreground">
          Same capability installed more than once in a single agent
        </span>
      </header>
      <div className="agent-duplicate-region">
        <table className="agent-duplicate-table">
          <thead>
            <tr>
              <th scope="col">Agent</th>
              <th scope="col">Capability</th>
              <th scope="col">Assessment</th>
              <th scope="col">Locations</th>
            </tr>
          </thead>
          <tbody>
            {duplicates.map((duplicate) => (
              <tr
                key={`${duplicate.provider}:${duplicate.kind}:${duplicate.name}`}
              >
                <td>
                  <ProviderBadge provider={duplicate.provider} />
                </td>
                <td>
                  <span className="agent-duplicate-name">{duplicate.name}</span>
                  <span className="agent-duplicate-kind">
                    {capabilityKindLabels[duplicate.kind]}
                  </span>
                </td>
                <td>
                  {duplicate.identicalContent ? (
                    <span className="agent-duplicate-verdict">Redundant</span>
                  ) : (
                    <span className="badge badge-status-warn">Shadowed</span>
                  )}
                  <span className="agent-duplicate-hint">
                    {duplicate.identicalContent
                      ? "Removing all but one is safe."
                      : "Copies differ — pick which one wins."}
                  </span>
                </td>
                <td>
                  {duplicate.copies.map((copy) =>
                    copy.sourcePath ? (
                      <code key={copy.id}>
                        {shortenHomePath(copy.sourcePath)}
                      </code>
                    ) : null,
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ComparisonTableRow({
  row,
  showAssessment,
}: {
  row: ComparisonRow;
  showAssessment: boolean;
}) {
  const KindIcon = kindIcons[row.kind];
  const origins = new Set(
    Object.values(row.cells).map((capability) => capability.origin),
  );
  const sharedOrigin =
    origins.size === 1 ? origins.values().next().value : undefined;

  return (
    <tr className={row.isDiscrepancy ? "agent-row-discrepancy" : undefined}>
      <th scope="row">
        <div className="agent-comparison-name">{row.name}</div>
        <div className="agent-comparison-metadata">
          <span
            className={`agent-kind-label ${kindMarkers[row.kind]} text-muted-foreground`}
          >
            <KindIcon aria-hidden="true" size={12} />
            {capabilityKindLabels[row.kind]}
          </span>
          {sharedOrigin ? (
            <>
              <span className="agent-comparison-separator" aria-hidden="true">
                ·
              </span>
              <span className="agent-comparison-origin">
                {originLabels[sharedOrigin]}
              </span>
            </>
          ) : origins.size > 1 ? (
            <>
              <span className="agent-comparison-separator" aria-hidden="true">
                ·
              </span>
              <span className="agent-comparison-origin agent-origin-mixed">
                Mixed sources
              </span>
            </>
          ) : null}
        </div>
        {/* Reviews are grouped into per-reason sections whose headings carry
            the reason, and the provider cells carry the specifics — a message
            here would only repeat both. Fixes share one section, so they still
            need their message to say what is broken. */}
        {showAssessment && row.assessment.level === "fix" ? (
          <span className="agent-assessment-reason">
            {row.assessment.message}
          </span>
        ) : null}
      </th>
      {row.isUniformAcrossProviders ? (
        <UniformComparisonCell row={row} />
      ) : (
        agentProviders.map((provider) => {
          const instruction = row.instructionCells?.[provider];
          const capability = row.cells[provider];
          const visibleSource = capability
            ? capabilitySourceLabel(capability)
            : undefined;
          const StatusIcon =
            capability?.status === "disabled"
              ? CircleSlash2
              : capability?.status === "unavailable"
                ? CircleX
                : Check;
          return (
            <td key={provider}>
              {instruction ? (
                <details className="agent-compare-detail">
                  <summary className="agent-instruction-summary">
                    <span>
                      <Check size={13} /> {instruction.filename}
                    </span>
                  </summary>
                  <code>{instruction.sourcePath}</code>
                  <pre>{instruction.content}</pre>
                </details>
              ) : capability ? (
                <>
                  <details className="agent-compare-detail">
                    <summary
                      className={
                        capability.status === "enabled" ||
                        capability.status === "installed"
                          ? `agent-status-tag agent-status-tag--chip ${statusBadges[capability.status]}`
                          : `agent-status-tag--bare agent-status-tag--${capability.status}`
                      }
                      title={statusLabels[capability.status]}
                      aria-label={statusLabels[capability.status]}
                    >
                      <StatusIcon size={13} />
                    </summary>
                    <span>{originLabels[capability.origin]}</span>
                    <span>{capability.packaging.replace("_", " ")}</span>
                    {capability.sourceRepository &&
                    capability.sourceRepository !== visibleSource ? (
                      <code>{capability.sourceRepository}</code>
                    ) : null}
                    {capability.sourcePath ? (
                      <code>{capability.sourcePath}</code>
                    ) : null}
                  </details>
                  {visibleSource ? (
                    <span className="agent-compare-source">
                      {visibleSource}
                    </span>
                  ) : null}
                </>
              ) : (
                <span
                  className="agent-missing agent-status-tag--bare"
                  title="Missing"
                  aria-label="Missing"
                >
                  <Minus size={13} />
                </span>
              )}
            </td>
          );
        })
      )}
    </tr>
  );
}

function UniformComparisonCell({ row }: { row: ComparisonRow }) {
  const capability = row.cells[agentProviders[0]]!;
  const visibleSource = capabilitySourceLabel(capability);
  const StatusIcon =
    capability.status === "disabled"
      ? CircleSlash2
      : capability.status === "unavailable"
        ? CircleX
        : Check;

  return (
    <td colSpan={agentProviders.length}>
      <details className="agent-compare-detail agent-all-agents-detail">
        <summary
          className={`agent-status-tag ${statusBadges[capability.status]}`}
        >
          <StatusIcon size={13} /> All agents ·{" "}
          {statusLabels[capability.status]}
        </summary>
        <span>{originLabels[capability.origin]}</span>
        <span>{capability.packaging.replace("_", " ")}</span>
        {capability.sourceRepository &&
        capability.sourceRepository !== visibleSource ? (
          <code>{capability.sourceRepository}</code>
        ) : null}
      </details>
      {visibleSource ? (
        <span className="agent-compare-source">{visibleSource}</span>
      ) : null}
    </td>
  );
}
