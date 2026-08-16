import { providerBadges, providerLabels } from "@/lib/labels";
import type { AgentProvider } from "@/lib/types";

// Provider identity chip. Kept as a component rather than a labels.ts helper
// so the badge palette and display label stay paired at every call site.
export function ProviderBadge({ provider }: { provider: AgentProvider }) {
  return (
    <span className={`badge ${providerBadges[provider]}`}>
      {providerLabels[provider]}
    </span>
  );
}
