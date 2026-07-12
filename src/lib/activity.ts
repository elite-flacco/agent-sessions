import type { ActivityStreamRow } from "./queries";
import type { AgentProvider, SessionStatus } from "./types";

export interface ActivityBlock {
  key: string;
  sessionId: number;
  sessionTitle: string;
  provider: AgentProvider;
  repository: string | null;
  branch: string | null;
  sessionStatus: SessionStatus;
  events: ActivityStreamRow[];
}

/**
 * Collapse consecutive events from the same session into blocks while
 * preserving the overall chronological order of the stream.
 */
export function groupStream(rows: ActivityStreamRow[]): ActivityBlock[] {
  const blocks: ActivityBlock[] = [];
  for (const row of rows) {
    const previous = blocks.at(-1);
    if (previous && previous.sessionId === row.sessionId) {
      previous.events.push(row);
      continue;
    }
    blocks.push({
      key: `${row.sessionId}-${row.id}`,
      sessionId: row.sessionId,
      sessionTitle: row.sessionTitle,
      provider: row.provider,
      repository: row.repository,
      branch: row.branch,
      sessionStatus: row.sessionStatus,
      events: [row],
    });
  }
  return blocks;
}
