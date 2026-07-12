import { describe, expect, it } from "vitest";
import { groupStream } from "./activity";
import type { ActivityStreamRow } from "./queries";

function row(
  id: number,
  sessionId: number,
  overrides: Partial<ActivityStreamRow> = {},
): ActivityStreamRow {
  return {
    id,
    kind: "tool",
    title: `Event ${id}`,
    detail: null,
    occurredAt: new Date(2026, 0, 1, 0, id).toISOString(),
    sessionId,
    sessionTitle: `Session ${sessionId}`,
    provider: "codex",
    repository: "relay",
    branch: "main",
    sessionStatus: "running",
    ...overrides,
  };
}

describe("groupStream", () => {
  it("returns no blocks for an empty stream", () => {
    expect(groupStream([])).toEqual([]);
  });

  it("collapses consecutive events from the same session", () => {
    const blocks = groupStream([row(4, 1), row(3, 2), row(2, 2), row(1, 1)]);
    expect(blocks).toHaveLength(3);
    expect(blocks.map((block) => block.sessionId)).toEqual([1, 2, 1]);
    expect(blocks[1].events.map((event) => event.id)).toEqual([3, 2]);
  });

  it("keeps session context on each block", () => {
    const [block] = groupStream([row(1, 7, { repository: null })]);
    expect(block.sessionTitle).toBe("Session 7");
    expect(block.repository).toBeNull();
    expect(block.key).toBe("7-1");
  });
});
