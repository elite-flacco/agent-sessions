import { AlertTriangle } from "lucide-react";
import type { AgentInventory, ScheduledTask } from "@/lib/agent-inventory";
import { compareScheduledTasks } from "@/lib/agent-inventory/schedule";
import { shortenHomePath } from "@/lib/format";
import { ProviderBadge } from "../provider-badge";

const scheduledStatusLabels: Record<ScheduledTask["status"], string> = {
  active: "Active",
  paused: "Paused",
  disabled: "Disabled",
  unknown: "Unknown",
};

const scheduledStatusBadges: Record<ScheduledTask["status"], string> = {
  active: "badge-status-ok",
  paused: "badge-status-warn",
  disabled: "badge-status-warn",
  unknown: "badge-status-muted",
};

export function scheduledTasksFor(
  inventories: AgentInventory[],
): ScheduledTask[] {
  return inventories
    .flatMap((inventory) => inventory.scheduledTasks ?? [])
    .sort(compareScheduledTasks);
}

/**
 * Third `/agents` tab. Renders all discovered scheduled/recurring tasks in a
 * single schedule-first table (sorted by cadence, active tasks first). Empty
 * providers contribute no rows and render nothing. Each row is a native
 * `<details name="agent-tasks">` so only one row is open at a time (exclusive
 * accordion) with zero client-side JavaScript. The KindRail is scoped to
 * InventoryView so it does not render here.
 */
export function ScheduledTasksView({
  inventories,
}: {
  inventories: AgentInventory[];
}) {
  const tasks = scheduledTasksFor(inventories);
  const total = tasks.length;
  return (
    <div>
      {total === 0 ? (
        <div className="card empty-state agent-empty-state">
          <h3>No scheduled tasks found across agents.</h3>
        </div>
      ) : (
        <div className="agent-task-table">
          <div className="agent-task-head">
            <span aria-hidden="true" />
            <span>Schedule</span>
            <span>Task</span>
            <span>Agent</span>
            <span>Status</span>
          </div>
          {tasks.map((task) => (
            <ScheduledTaskDetails
              key={`${task.provider}:${task.id}`}
              task={task}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ScheduledTaskDetails({ task }: { task: ScheduledTask }) {
  const schedule = task.scheduleHuman ?? task.scheduleRaw;
  const project = task.targetProjectName ?? task.targetProject;
  return (
    <details name="agent-tasks" className="agent-task-row">
      <summary className="agent-task-summary">
        <span className="agent-task-sched">
          {schedule ?? "Schedule unavailable"}
        </span>
        {/* Name and flag share one grid cell so the badge columns stay aligned. */}
        <span className="agent-task-title">
          <strong className="agent-task-name">{task.name}</strong>
          {task.warnings.some((item) => item.code === "orphaned") ? (
            <span className="agent-task-flag">Target missing</span>
          ) : null}
        </span>
        <ProviderBadge provider={task.provider} />
        <span
          className={`badge ${scheduledStatusBadges[task.status]} agent-status-tag`}
        >
          {scheduledStatusLabels[task.status]}
        </span>
      </summary>
      <div className="agent-task-detail">
        <div className="agent-task-meta">
          {task.model ? (
            <span>
              Model: <code>{task.model}</code>
            </span>
          ) : null}
          {project ? (
            <span>
              Project: <code>{project}</code>
            </span>
          ) : null}
          <span>
            Source: <code>{shortenHomePath(task.sourcePath)}</code>
          </span>
        </div>
        {task.warnings.map((item) => (
          <div className="notice" key={`${item.code}:${item.message}`}>
            <AlertTriangle size={14} aria-hidden="true" />
            <span>{item.message}</span>
          </div>
        ))}
        {task.instructionBody ? (
          <pre className="agent-task-instruction">{task.instructionBody}</pre>
        ) : null}
      </div>
    </details>
  );
}
