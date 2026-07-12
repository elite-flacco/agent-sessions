import type { AgentProvider, CostSource, SessionStatus } from "./types";

export const providerLabels: Record<AgentProvider, string> = {
  codex: "Codex",
  claude: "Claude Code",
  zcode: "Zcode",
  pi: "Pi",
};

export const providerBadges: Record<AgentProvider, string> = {
  codex: "badge-1",
  claude: "badge-4",
  zcode: "badge-3",
  pi: "badge-2",
};

export const costSourceLabels: Record<CostSource, string> = {
  reported: "Reported",
  estimated: "Estimated",
  unavailable: "Unavailable",
};

export const statusLabels: Record<SessionStatus, string> = {
  running: "Running",
  completed: "Completed",
  needs_attention: "Needs attention",
  interrupted: "Interrupted",
  incomplete: "Incomplete",
  unknown: "Unknown",
};
