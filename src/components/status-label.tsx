import { statusDisplay } from "@/lib/labels";
import type { SessionStatus, StatusReason } from "@/lib/types";

// Status dot + human-readable label. The `status-${status}` class drives the
// dot color from the design tokens. Shared by the sessions list, session
// detail, and subagent rows. (The Overview "session line" uses a bare colored
// dot instead and intentionally does not use this component.)
export function StatusLabel({
  status,
  reason,
}: {
  status: SessionStatus;
  reason?: StatusReason | null;
}) {
  return (
    <span className={`status-label status-${status}`}>
      <i />
      {statusDisplay(status, reason)}
    </span>
  );
}
