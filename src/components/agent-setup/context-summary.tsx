import {
  findComparisonDuplicates,
  type AgentInventory,
} from "@/lib/agent-inventory";
import { pluralize } from "@/lib/format";
import { providerLabels } from "@/lib/labels";
import { filteredComparisonRows } from "./comparison-view";
import type { AgentSetupFilters } from "./filters";
import { inventorySourceFor } from "./meta";
import { scheduledTasksFor } from "./tasks-view";

export interface ContextSummaryMetric {
  value: string;
  label: string;
  tone?: "success" | "warning" | "danger";
}

export function ContextSummary({
  ariaLabel,
  title,
  metrics,
}: {
  ariaLabel: string;
  title: string;
  metrics: ContextSummaryMetric[];
}) {
  return (
    <section className="agent-context-summary" aria-label={ariaLabel}>
      <strong>{title}</strong>
      <ul className="agent-context-metrics" aria-label={`${title} metrics`}>
        {metrics.map((metric) => (
          <li
            key={`${metric.value}:${metric.label}`}
            className={
              metric.tone
                ? `agent-context-metric is-${metric.tone}`
                : "agent-context-metric"
            }
          >
            <strong>{metric.value}</strong>{" "}
            <span className="text-muted-foreground">{metric.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AgentSetupContextSummary({
  inventories,
  filters,
}: {
  inventories: AgentInventory[];
  filters: AgentSetupFilters;
}) {
  if (filters.view === "inventory") {
    const inventory =
      inventories.find((entry) => entry.provider === filters.provider) ??
      inventories[0];
    if (!inventory) return null;
    const activeCapabilities = inventory.capabilities.filter(
      (capability) => capability.status !== "disabled",
    );
    const activeSkills = activeCapabilities.filter(
      (capability) => capability.kind === "skill",
    );
    const skillSourceCount = new Set(activeSkills.map(inventorySourceFor)).size;
    return (
      <ContextSummary
        ariaLabel="Inventory summary"
        title={`${providerLabels[inventory.provider]} inventory`}
        metrics={[
          {
            value: String(activeCapabilities.length),
            label: pluralize(
              activeCapabilities.length,
              "capability",
              "capabilities",
            ),
          },
          {
            value: String(activeSkills.length),
            label: pluralize(activeSkills.length, "skill"),
          },
          {
            value: String(skillSourceCount),
            label: pluralize(skillSourceCount, "source"),
          },
          {
            value: inventory.instructionFile?.filename ?? "Unavailable",
            label: "instructions",
          },
        ]}
      />
    );
  }

  if (filters.view === "compare") {
    const rows = filteredComparisonRows(inventories, filters);
    const fixCount = rows.filter(
      (row) => row.assessment.level === "fix",
    ).length;
    const reviewCount = rows.filter(
      (row) => row.assessment.level === "review",
    ).length;
    const duplicateCount = findComparisonDuplicates(inventories).length;
    return (
      <ContextSummary
        ariaLabel="Comparison summary"
        title="Setup comparison"
        metrics={[
          {
            value: String(inventories.length),
            label: pluralize(inventories.length, "agent"),
          },
          {
            value: String(fixCount),
            label: pluralize(fixCount, "fix", "fixes"),
            tone: fixCount > 0 ? "danger" : undefined,
          },
          {
            value: String(reviewCount),
            label: pluralize(reviewCount, "review"),
            tone: reviewCount > 0 ? "warning" : undefined,
          },
          {
            value: String(duplicateCount),
            label: pluralize(duplicateCount, "duplicate install"),
            tone: duplicateCount > 0 ? "warning" : undefined,
          },
        ]}
      />
    );
  }

  const tasks = scheduledTasksFor(inventories);
  const activeCount = tasks.filter((task) => task.status === "active").length;
  const inactiveCount = tasks.filter(
    (task) =>
      task.status === "paused" ||
      task.status === "disabled" ||
      task.status === "completed",
  ).length;
  const orphanedCount = tasks.filter((task) =>
    task.warnings.some((warning) => warning.code === "orphaned"),
  ).length;
  return (
    <ContextSummary
      ariaLabel="Scheduled tasks summary"
      title="Task health"
      metrics={[
        {
          value: String(tasks.length),
          label: pluralize(tasks.length, "task"),
        },
        {
          value: String(activeCount),
          label: "active",
          tone: activeCount > 0 ? "success" : undefined,
        },
        {
          value: String(inactiveCount),
          label: "inactive",
          tone: inactiveCount > 0 ? "warning" : undefined,
        },
        {
          value: String(orphanedCount),
          label: `${pluralize(orphanedCount, "target")} missing`,
          tone: orphanedCount > 0 ? "danger" : undefined,
        },
      ]}
    />
  );
}
