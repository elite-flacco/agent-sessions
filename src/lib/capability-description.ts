import type { ObservedCapabilityPlugin } from "./types";

/** Presentation follows explicit attribution, never server or tool-name guesses. */
export function describeCapability(
  kind: "skill" | "mcp",
  name: string,
  plugins: ObservedCapabilityPlugin[] = [],
): { label: string; description?: string } {
  if (kind !== "mcp" || plugins.length !== 1) return { label: name };
  return {
    label: plugins[0].name,
    ...(plugins[0].description ? { description: plugins[0].description } : {}),
  };
}
