import type { OverviewRange } from "./queries";
import type {
  AgentProvider,
  CostSource,
  SessionStatus,
  StatusReason,
} from "./types";

// Shared "7 days" / "30 days" copy for range-scoped views. Sentence-context
// phrasings ("this week", "the last 30 days") stay inline at their call sites
// because they vary by surrounding grammar.
export function rangeDaysLabel(range: OverviewRange): string {
  return range === "7d" ? "7 days" : range === "30d" ? "30 days" : "all time";
}

export const providerLabels: Record<AgentProvider, string> = {
  codex: "Codex",
  claude: "Claude Code",
  zcode: "Zcode",
  pi: "Pi",
};

/**
 * Provider identity badges. These deliberately do not use the numbered
 * `badge-N` palette: those slots are shared with other roles, which is how a
 * provider and a status ended up wearing the same colour. Identity now owns a
 * dedicated band (see `--agent-*` in globals.css).
 */
export const providerBadges: Record<AgentProvider, string> = {
  codex: "badge-agent-codex",
  claude: "badge-agent-claude",
  zcode: "badge-agent-zcode",
  pi: "badge-agent-pi",
};

export const providerDotColors: Record<AgentProvider, string> = {
  codex: "bg-agent-codex-foreground",
  claude: "bg-agent-claude-foreground",
  zcode: "bg-agent-zcode-foreground",
  pi: "bg-agent-pi-foreground",
};

export const costSourceLabels: Record<CostSource, string> = {
  reported: "Reported",
  estimated: "Estimated",
  unavailable: "Unavailable",
};

export const statusLabels: Record<SessionStatus, string> = {
  running: "Running",
  completed: "Completed",
  needs_attention: "Awaiting input",
  failed: "Failed",
  interrupted: "Interrupted",
  incomplete: "Incomplete",
  unknown: "Unknown",
};

export const statusReasonLabels: Record<StatusReason, string> = {
  usage_limit: "Usage limit",
  insufficient_balance: "Insufficient balance",
  network_error: "Network error",
  model_error: "Model error",
  execution_error: "Execution failed",
};

/**
 * The user-facing status text, appending the specific reason when present
 * (e.g. "Failed · Usage limit"). Reasons attach only to `failed`.
 */
export function statusDisplay(
  status: SessionStatus,
  reason?: StatusReason | null,
): string {
  return reason
    ? `${statusLabels[status]} · ${statusReasonLabels[reason]}`
    : statusLabels[status];
}
