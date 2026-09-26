// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import type {
  SessionTranscript,
  TranscriptEntry,
  TranscriptEntryKind,
} from "@/lib/transcript";
import { buildTurns, toolPreview, TranscriptView } from "./transcript-view";

afterEach(cleanup);

function entry(
  overrides: Partial<TranscriptEntry> & {
    id: string;
    kind: TranscriptEntryKind;
  },
): TranscriptEntry {
  return {
    title:
      overrides.kind === "user"
        ? "User"
        : overrides.kind === "assistant"
          ? "Assistant"
          : "Tool call",
    content: null,
    input: null,
    output: null,
    occurredAt: null,
    isError: false,
    ...overrides,
  };
}

describe("buildTurns", () => {
  test("starts a turn at each user entry and keeps a leading turn", () => {
    const turns = buildTurns([
      entry({ id: "1", kind: "assistant", content: "prior context" }),
      entry({ id: "2", kind: "user", content: "hello" }),
      entry({ id: "3", kind: "assistant", content: "hi" }),
    ]);
    expect(turns).toHaveLength(2);
    expect(turns.map((turn) => turn.id)).toEqual(["turn-1", "turn-2"]);
    expect(turns[0].blocks.map((block) => block.kind)).toEqual(["message"]);
    expect(turns[1].blocks.map((block) => block.kind)).toEqual([
      "message",
      "message",
    ]);
  });

  test("merges consecutive tool and result entries into one cluster block", () => {
    const turns = buildTurns([
      entry({ id: "u", kind: "user" }),
      entry({ id: "a", kind: "assistant" }),
      entry({ id: "t1", kind: "tool", title: "Read" }),
      entry({ id: "r1", kind: "result", title: "Tool result" }),
      entry({ id: "t2", kind: "tool", title: "Edit" }),
      entry({ id: "a2", kind: "assistant" }),
    ]);
    expect(turns).toHaveLength(1);
    // The user and assistant entries each get their own message block, so a
    // u/a/tool-run/a2 turn yields four blocks (the brief's expected array of
    // three is unsatisfiable with the single-entry message block type).
    expect(turns[0].blocks.map((block) => block.kind)).toEqual([
      "message",
      "message",
      "tool-cluster",
      "message",
    ]);
    const cluster = turns[0].blocks[2];
    if (cluster.kind !== "tool-cluster") throw new Error("expected cluster");
    expect(cluster.entries.map((item) => item.id)).toEqual(["t1", "r1", "t2"]);
  });

  test("returns no turns for an empty transcript", () => {
    expect(buildTurns([])).toEqual([]);
  });
});

describe("toolPreview", () => {
  test("prefers well-known keys from parsed JSON input", () => {
    expect(
      toolPreview(
        entry({
          id: "t",
          kind: "tool",
          input: '{\n  "file_path": "src/app/page.tsx",\n  "limit": 10\n}',
        }),
      ),
    ).toBe("src/app/page.tsx");
    expect(
      toolPreview(
        entry({ id: "t", kind: "tool", input: '{"command": "npm test"}' }),
      ),
    ).toBe("npm test");
  });

  test("falls back to the first string value, then raw input, then empty", () => {
    expect(
      toolPreview(
        entry({
          id: "t",
          kind: "tool",
          input: '{"zeta": "zz", "alpha": "aa"}',
        }),
      ),
    ).toBe("zz");
    expect(
      toolPreview(entry({ id: "t", kind: "tool", input: "plain text input" })),
    ).toBe("plain text input");
    expect(toolPreview(entry({ id: "t", kind: "tool", input: null }))).toBe("");
  });

  test("collapses whitespace and truncates long previews to 80 chars", () => {
    const long = "x".repeat(120);
    const preview = toolPreview(
      entry({
        id: "t",
        kind: "tool",
        input: JSON.stringify({ command: long }),
      }),
    );
    expect(preview).toHaveLength(80);
    expect(preview.endsWith("…")).toBe(true);
    expect(
      toolPreview(
        entry({ id: "t", kind: "tool", input: "line one\nline two" }),
      ),
    ).toBe("line one line two");
  });
});

const thinkingContent =
  "I'll check the settings page layout first. Then I'll find the auth hooks we already use elsewhere.";
const thinkingPreview = `${thinkingContent.slice(0, 79)}…`;

const fixture: SessionTranscript = {
  entries: [
    entry({
      id: "u1",
      kind: "user",
      content: "Add a logout button to settings",
      occurredAt: "2026-09-23T10:42:00Z",
    }),
    entry({
      id: "th1",
      kind: "reasoning",
      title: "Thinking",
      content: thinkingContent,
      occurredAt: "2026-09-23T10:42:10Z",
    }),
    entry({
      id: "a1",
      kind: "assistant",
      content: "I'll look at the layout first.",
      occurredAt: "2026-09-23T10:42:30Z",
    }),
    entry({
      id: "t1",
      kind: "tool",
      title: "Read",
      input: '{"file_path": "src/app/settings/page.tsx"}',
      output: "1  export default function…",
      occurredAt: "2026-09-23T10:42:40Z",
    }),
    entry({
      id: "t2",
      kind: "tool",
      title: "Bash",
      input: '{"command": "npm test"}',
      output: "exit 1",
      isError: true,
      occurredAt: "2026-09-23T10:43:00Z",
    }),
    entry({
      id: "a2",
      kind: "assistant",
      content: "Done.",
      occurredAt: "2026-09-23T10:44:00Z",
    }),
  ],
  sourceAvailable: true,
  truncated: false,
};

describe("TranscriptView", () => {
  test("renders turn-grouped messages with a tool cluster", () => {
    render(<TranscriptView transcript={fixture} />);
    expect(screen.getByText("Add a logout button to settings")).toBeVisible();
    expect(screen.getByText("2 tool calls")).toBeVisible();
    expect(screen.getByText("Read")).toBeVisible();
    expect(screen.getByText("src/app/settings/page.tsx")).toBeVisible();
    expect(screen.getByText("Error")).toBeVisible();
    expect(screen.getByText("npm test")).toBeVisible();
  });

  test("payloads stay collapsed until Expand all", () => {
    render(<TranscriptView transcript={fixture} />);
    // Both tool rows carry an Arguments payload, so assert per row.
    const argumentDetails = () =>
      screen.getAllByText("Arguments").map((label) => label.closest("details"));
    for (const details of argumentDetails())
      expect(details).not.toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    for (const details of argumentDetails())
      expect(details).toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    for (const details of argumentDetails())
      expect(details).not.toHaveAttribute("open");
  });

  test("clicking a tool row summary expands that row's payload", () => {
    render(<TranscriptView transcript={fixture} />);
    const row = screen
      .getByText("Read")
      .closest("details") as HTMLDetailsElement;
    expect(row).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("Read"));
    expect(row).toHaveAttribute("open");
    // Both tool rows render an Arguments label; scope to the clicked row.
    expect(within(row).getByText("Arguments")).toBeVisible();
  });

  test("conversation filter hides tool clusters", () => {
    render(<TranscriptView transcript={fixture} />);
    fireEvent.click(screen.getByRole("button", { name: "Conversation" }));
    expect(screen.queryByText("2 tool calls")).not.toBeInTheDocument();
    expect(screen.getByText("Add a logout button to settings")).toBeVisible();
  });

  test("tools filter shows flat rows without cluster framing", () => {
    render(<TranscriptView transcript={fixture} />);
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    expect(screen.queryByText("2 tool calls")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Add a logout button to settings"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Read")).toBeVisible();
    expect(screen.getByText("Bash")).toBeVisible();
  });

  test("empty conversation filter keeps the empty-state copy", () => {
    const toolsOnly: SessionTranscript = {
      ...fixture,
      entries: fixture.entries.filter(
        (item) => item.kind === "tool" || item.kind === "result",
      ),
    };
    render(<TranscriptView transcript={toolsOnly} />);
    fireEvent.click(screen.getByRole("button", { name: "Conversation" }));
    expect(screen.getByText(/No conversation entries/)).toBeVisible();
  });

  test("renders thinking blocks collapsed with a one-line preview", () => {
    render(<TranscriptView transcript={fixture} />);
    const thinking = screen.getByText("Thinking").closest("details");
    expect(thinking).not.toHaveAttribute("open");
    expect(screen.getByText(thinkingPreview)).toBeVisible();
  });

  test("expanding a thinking block reveals its content", () => {
    render(<TranscriptView transcript={fixture} />);
    const thinking = screen.getByText("Thinking").closest("details");
    const summary = thinking?.querySelector("summary");
    if (!summary) throw new Error("thinking summary missing");
    fireEvent.click(summary);
    expect(thinking).toHaveAttribute("open");
    expect(screen.getByText(thinkingContent)).toBeVisible();
  });

  test("conversation filter keeps thinking; tools filter drops it", () => {
    render(<TranscriptView transcript={fixture} />);
    fireEvent.click(screen.getByRole("button", { name: "Conversation" }));
    expect(screen.getByText("Thinking")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    expect(screen.queryByText("Thinking")).not.toBeInTheDocument();
  });

  test("thinking renders inside the turn before the tool cluster", () => {
    const { container } = render(<TranscriptView transcript={fixture} />);
    const thinking = container.querySelector(
      ".transcript-turn > .transcript-thinking",
    );
    const cluster = container.querySelector(
      ".transcript-turn > .transcript-tool-cluster",
    );
    expect(thinking?.previousElementSibling?.tagName).toBe("ARTICLE");
    expect(
      thinking && cluster
        ? Boolean(
            thinking.compareDocumentPosition(cluster) &
            Node.DOCUMENT_POSITION_FOLLOWING,
          )
        : false,
    ).toBe(true);
  });
});
