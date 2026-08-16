// Re-export shim: the agent setup UI lives in ./agent-setup/, split by view.
// Tests and the /agents page keep importing from this path.
export { AgentSetupView } from "./agent-setup/agent-setup-view";
export { parseAgentSetupFilters } from "./agent-setup/filters";
export type {
  AgentSetupFilters,
  AgentSetupKind,
  AgentSetupViewMode,
} from "./agent-setup/filters";
