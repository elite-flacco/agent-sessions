// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type {
  SessionTranscript,
  TranscriptEntry,
  TranscriptEntryKind,
} from "@/lib/transcript";
import {
  blockEntries,
  buildTurns,
  summarizeTurn,
  toolPreview,
  TranscriptView,
} from "./transcript-view";

// jsdom implements no scrolling, no layout, and no rAF scheduling we can
// await, so record requested positions, let tests place elements, and drain
// animation frames by hand.
const scrolledTo: number[] = [];
const scrolledInto: Element[] = [];
let frames: FrameRequestCallback[] = [];

/** Run every animation frame the view has queued. */
function runFrames(): void {
  const queued = frames;
  frames = [];
  for (const callback of queued) callback(0);
}

/** Pretend an element sits `top` pixels from the top of the viewport. */
function place(container: HTMLElement, selector: string, top: number): void {
  const node = container.querySelector(selector);
  if (!node) throw new Error(`missing ${selector}`);
  node.getBoundingClientRect = () => ({ top }) as DOMRect;
}

beforeEach(() => {
  scrolledTo.length = 0;
  scrolledInto.length = 0;
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  // The hash survives between tests in jsdom, and the view honours it on
  // mount, so clear it or every later render scrolls on load.
  history.replaceState(null, "", window.location.pathname);
  vi.stubGlobal("scrollTo", (options: ScrollToOptions) => {
    scrolledTo.push(options.top ?? 0);
  });
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
    scrolledInto.push(this);
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

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
    completedAt: null,
    input: null,
    output: null,
    occurredAt: null,
    isError: false,
    ...overrides,
  };
}

/**
 * Work groups render folded, so a test that reads their rows opens them first.
 */
function expandGroups(): void {
  for (const toggle of screen.queryAllByRole("button", { expanded: false }))
    if (toggle.classList.contains("transcript-group-toggle"))
      fireEvent.click(toggle);
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
    expandGroups();
    expect(screen.getByText("Read")).toBeVisible();
    expect(screen.getByText("src/app/settings/page.tsx")).toBeVisible();
    expect(screen.getByText("Error")).toBeVisible();
    expect(screen.getByText("npm test")).toBeVisible();
  });

  test("payloads stay collapsed until Expand all", () => {
    render(<TranscriptView transcript={fixture} />);
    expandGroups();
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
    expandGroups();
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
    expandGroups();
    const thinking = screen.getByText("Thinking").closest("details");
    expect(thinking).not.toHaveAttribute("open");
    expect(screen.getByText(thinkingPreview)).toBeVisible();
  });

  test("expanding a thinking block reveals its content", () => {
    render(<TranscriptView transcript={fixture} />);
    expandGroups();
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
    expandGroups();
    expect(screen.getByText("Thinking")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    expect(screen.queryByText("Thinking")).not.toBeInTheDocument();
  });

  test("thinking rides inside a work group rather than beside one", () => {
    const { container } = render(<TranscriptView transcript={fixture} />);
    expandGroups();
    // The fixture puts an assistant message between the thought and the tool
    // run, so they are separate groups — but the thought still belongs to one.
    const thinking = container.querySelector(
      ".transcript-tool-cluster .transcript-thinking",
    );
    expect(thinking).toBeTruthy();
    expect(
      container.querySelector(".transcript-turn > .transcript-thinking"),
    ).toBeNull();
  });
});

describe("trajectory affordances", () => {
  function transcript(entries: TranscriptEntry[]): SessionTranscript {
    return { entries, sourceAvailable: true, truncated: false };
  }

  const day = "2026-09-24T20:00:00.000Z";

  function at(offsetMs: number): string {
    return new Date(new Date(day).getTime() + offsetMs).toISOString();
  }

  test("a lone tool call is a folded group, without an Expand all", () => {
    const { container } = render(
      <TranscriptView
        transcript={transcript([
          entry({ id: "u", kind: "user", content: "go", occurredAt: at(0) }),
          entry({
            id: "t",
            kind: "tool",
            title: "Bash",
            occurredAt: at(1_000),
          }),
        ])}
      />,
    );
    expect(container.querySelector(".transcript-tool-rows")).toBeNull();
    const header = screen.getByRole("button", { name: "1 tool call" });
    expect(header).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(header);
    expect(screen.getByText("Bash")).toBeVisible();
    // One row has nothing to expand *all* of.
    expect(
      screen.queryByRole("button", { name: "Expand all" }),
    ).not.toBeInTheDocument();
  });

  test("a multi-call cluster keeps its header", () => {
    render(
      <TranscriptView
        transcript={transcript([
          entry({ id: "u", kind: "user", content: "go", occurredAt: at(0) }),
          entry({
            id: "t1",
            kind: "tool",
            title: "Bash",
            occurredAt: at(1_000),
          }),
          entry({
            id: "t2",
            kind: "tool",
            title: "Read",
            occurredAt: at(2_000),
          }),
        ])}
      />,
    );
    expect(screen.getByText("2 tool calls")).toBeVisible();
    expandGroups();
    expect(screen.getByRole("button", { name: "Expand all" })).toBeVisible();
  });

  test("a tool call shows its duration when the result was timed", () => {
    render(
      <TranscriptView
        transcript={transcript([
          entry({ id: "u", kind: "user", content: "go", occurredAt: at(0) }),
          entry({
            id: "t1",
            kind: "tool",
            title: "Bash",
            occurredAt: at(1_000),
            completedAt: at(3_500),
          }),
          entry({
            id: "t2",
            kind: "tool",
            title: "Read",
            occurredAt: at(4_000),
          }),
        ])}
      />,
    );
    expandGroups();
    expect(screen.getByText("2.5s")).toBeVisible();
  });

  test("a long pause between turns renders an idle divider", () => {
    const { container } = render(
      <TranscriptView
        transcript={transcript([
          entry({
            id: "u1",
            kind: "user",
            content: "first",
            occurredAt: at(0),
          }),
          entry({
            id: "a1",
            kind: "assistant",
            content: "ok",
            occurredAt: at(1_000),
          }),
          entry({
            id: "u2",
            kind: "user",
            content: "second",
            occurredAt: at(90 * 60_000),
          }),
        ])}
      />,
    );
    const idle = container.querySelector(".transcript-divider-idle");
    expect(idle?.textContent).toContain("Idle 1h 29m");
  });

  test("a short pause between turns renders no idle divider", () => {
    const { container } = render(
      <TranscriptView
        transcript={transcript([
          entry({
            id: "u1",
            kind: "user",
            content: "first",
            occurredAt: at(0),
          }),
          entry({
            id: "u2",
            kind: "user",
            content: "second",
            occurredAt: at(60_000),
          }),
        ])}
      />,
    );
    expect(container.querySelector(".transcript-divider-idle")).toBeNull();
  });
});

describe("trajectory markers", () => {
  function transcript(entries: TranscriptEntry[]): SessionTranscript {
    return { entries, sourceAvailable: true, truncated: false };
  }

  const user = entry({ id: "u", kind: "user", content: "go" });

  test("a TodoWrite renders the plan diff instead of a tool row", () => {
    const { container } = render(
      <TranscriptView
        transcript={transcript([
          user,
          entry({
            id: "todo",
            kind: "tool",
            title: "TodoWrite",
            output: JSON.stringify({
              oldTodos: [{ content: "Explore", status: "in_progress" }],
              todos: [
                { content: "Explore", status: "completed" },
                { content: "Build", status: "in_progress" },
              ],
            }),
          }),
        ])}
      />,
    );
    expect(
      container.querySelector('.transcript-marker[data-marker="plan"]'),
    ).toBeTruthy();
    expect(screen.getByText("Plan · 1/2")).toBeVisible();
    expect(screen.getByText("Explore")).toBeVisible();
    expect(screen.getByText("Build")).toBeVisible();
    expect(screen.queryByText("TodoWrite")).not.toBeInTheDocument();
  });

  test("an AskUserQuestion renders the question and the answer", () => {
    render(
      <TranscriptView
        transcript={transcript([
          user,
          entry({
            id: "ask",
            kind: "tool",
            title: "AskUserQuestion",
            input: JSON.stringify({
              questions: [{ question: "Collapsed or expanded?" }],
            }),
            output: '"Collapsed or expanded?"="Collapsed"',
          }),
        ])}
      />,
    );
    expect(screen.getByText("Asked the user")).toBeVisible();
    expect(screen.getByText("Collapsed or expanded?")).toBeVisible();
    expect(screen.getByText("Collapsed")).toBeVisible();
  });

  test("a Skill call renders as a phase marker", () => {
    const { container } = render(
      <TranscriptView
        transcript={transcript([
          user,
          entry({
            id: "skill",
            kind: "tool",
            title: "Skill",
            input: JSON.stringify({ skill: "brainstorming", args: "a topic" }),
          }),
        ])}
      />,
    );
    expect(
      container.querySelector('.transcript-marker[data-marker="phase"]'),
    ).toBeTruthy();
    expect(screen.getByText("brainstorming")).toBeVisible();
    expect(screen.getByText("a topic")).toBeVisible();
  });

  test("an unparseable marker payload falls back to a tool row", () => {
    const { container } = render(
      <TranscriptView
        transcript={transcript([
          user,
          entry({
            id: "todo",
            kind: "tool",
            title: "TodoWrite",
            input: "oops",
          }),
        ])}
      />,
    );
    expect(container.querySelector(".transcript-marker")).toBeNull();
    expandGroups();
    expect(screen.getByText("TodoWrite")).toBeVisible();
  });

  test("a marker breaks the surrounding tool cluster in two", () => {
    const { container } = render(
      <TranscriptView
        transcript={transcript([
          user,
          entry({ id: "t1", kind: "tool", title: "Bash" }),
          entry({
            id: "skill",
            kind: "tool",
            title: "Skill",
            input: JSON.stringify({ skill: "brainstorming" }),
          }),
          entry({ id: "t2", kind: "tool", title: "Read" }),
        ])}
      />,
    );
    expect(container.querySelectorAll(".transcript-tool-cluster")).toHaveLength(
      2,
    );
  });

  test("the errors filter shows only failed calls", () => {
    render(
      <TranscriptView
        transcript={transcript([
          user,
          entry({ id: "ok", kind: "tool", title: "Bash" }),
          entry({ id: "bad", kind: "tool", title: "Write", isError: true }),
        ])}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Errors" }));
    expect(screen.getByText("Write")).toBeVisible();
    expect(screen.queryByText("Bash")).not.toBeInTheDocument();
    expect(screen.queryByText("go")).not.toBeInTheDocument();
  });

  test("the errors filter explains an error-free transcript", () => {
    render(
      <TranscriptView
        transcript={transcript([
          user,
          entry({ id: "ok", kind: "tool", title: "Bash" }),
        ])}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Errors" }));
    expect(
      screen.getByText("No failed entries in this transcript."),
    ).toBeVisible();
  });
});

describe("turn outline", () => {
  function transcript(entries: TranscriptEntry[]): SessionTranscript {
    return { entries, sourceAvailable: true, truncated: false };
  }

  const base = "2026-09-24T20:00:00.000Z";
  function at(offsetMs: number): string {
    return new Date(new Date(base).getTime() + offsetMs).toISOString();
  }

  function twoTurns(): SessionTranscript {
    return transcript([
      entry({
        id: "u1",
        kind: "user",
        content: "Improve the readability of the sessions page",
        occurredAt: at(0),
      }),
      entry({ id: "t1", kind: "tool", title: "Bash", occurredAt: at(1_000) }),
      entry({
        id: "t2",
        kind: "tool",
        title: "Agent",
        occurredAt: at(2_000),
        completedAt: at(9_000),
      }),
      entry({
        id: "u2",
        kind: "user",
        content: "Now ship it",
        occurredAt: at(20_000),
      }),
      entry({
        id: "t3",
        kind: "tool",
        title: "Write",
        occurredAt: at(21_000),
        isError: true,
      }),
    ]);
  }

  test("summarizeTurn counts calls, subagents, and errors", () => {
    const turns = buildTurns(twoTurns().entries);
    expect(summarizeTurn(turns[0], 0)).toMatchObject({
      label: "Improve the readability of the sessions page",
      toolCalls: 2,
      subagents: 1,
      errors: 0,
      durationMs: 9_000,
    });
    expect(summarizeTurn(turns[1], 1)).toMatchObject({
      label: "Now ship it",
      toolCalls: 1,
      subagents: 0,
      errors: 1,
    });
  });

  test("summarizeTurn names a leading turn that has no user entry", () => {
    const turns = buildTurns([
      entry({ id: "a1", kind: "assistant", content: "resuming" }),
    ]);
    expect(summarizeTurn(turns[0], 0).label).toBe("Session start");
  });

  test("the rail lists every turn with its roll-up", () => {
    render(<TranscriptView transcript={twoTurns()} />);
    const outline = screen.getByRole("navigation", { name: "Session outline" });
    expect(within(outline).getByText("2 turns")).toBeVisible();
    expect(
      within(outline).getByText("Improve the readability of the sessions page"),
    ).toBeVisible();
    expect(within(outline).getByText(/1 subagent/)).toBeVisible();
    expect(within(outline).getByText(/1 error/)).toBeVisible();
  });

  test("turns carry a stable anchor id", () => {
    const { container } = render(<TranscriptView transcript={twoTurns()} />);
    const sections = [...container.querySelectorAll(".transcript-turn")];
    expect(sections.map((node) => node.id)).toEqual(["turn-u1", "turn-u2"]);
  });

  test("the rail marks the turn currently in view", () => {
    const { container } = render(<TranscriptView transcript={twoTurns()} />);
    // window.innerHeight is 768 in jsdom, so the reading line sits at 268.
    place(container, "#turn-u1", -400);
    place(container, "#turn-u2", 100);
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => runFrames());
    expect(
      container.querySelector(".transcript-outline-current")?.textContent,
    ).toContain("Now ship it");

    place(container, "#turn-u2", 600);
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => runFrames());
    expect(
      container.querySelector(".transcript-outline-current")?.textContent,
    ).toContain("Improve the readability");
  });

  test("a turn header collapses and restores its blocks", () => {
    render(<TranscriptView transcript={twoTurns()} />);
    const header = screen.getByRole("button", { name: /Turn 1/ });
    expect(header).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("2 tool calls")).not.toBeInTheDocument();
    fireEvent.click(header);
    expandGroups();
    expect(screen.getByText("Bash")).toBeVisible();
  });

  test("choosing a collapsed turn in the rail expands it", () => {
    render(<TranscriptView transcript={twoTurns()} />);
    fireEvent.click(screen.getByRole("button", { name: /Turn 1/ }));
    expect(screen.queryByText("2 tool calls")).not.toBeInTheDocument();
    const outline = screen.getByRole("navigation", { name: "Session outline" });
    fireEvent.click(
      within(outline).getByText("Improve the readability of the sessions page"),
    );
    expandGroups();
    expect(screen.getByText("Bash")).toBeVisible();
    expect(scrolledTo).toHaveLength(1);
  });

  test("the rail scrolls to the turn it was given, allowing for the offset", () => {
    const { container } = render(<TranscriptView transcript={twoTurns()} />);
    expect(scrolledTo).toEqual([]);
    const second = container.querySelector("#turn-u2");
    if (!second) throw new Error("second turn missing");
    second.getBoundingClientRect = () => ({ top: 900 }) as DOMRect;
    const outline = screen.getByRole("navigation", { name: "Session outline" });
    fireEvent.click(within(outline).getByText("Now ship it"));
    expect(scrolledTo).toEqual([900 - 16]);
    expect(window.location.hash).toBe("#turn-u2");
  });

  test("honours a turn anchor already in the address bar on mount", () => {
    history.replaceState(null, "", "#turn-u2");
    const { container } = render(<TranscriptView transcript={twoTurns()} />);
    const second = container.querySelector("#turn-u2");
    expect(second).toBeTruthy();
    expect(scrolledTo).toHaveLength(1);
  });

  test("the rail marks a turn as soon as it is chosen", () => {
    const { container } = render(<TranscriptView transcript={twoTurns()} />);
    const outline = screen.getByRole("navigation", { name: "Session outline" });
    fireEvent.click(within(outline).getByText("Now ship it"));
    expect(
      container.querySelector(".transcript-outline-current")?.textContent,
    ).toContain("Now ship it");
  });

  test("a single-turn transcript shows no rail and no turn headers", () => {
    const { container } = render(
      <TranscriptView
        transcript={transcript([
          entry({ id: "u1", kind: "user", content: "hi", occurredAt: at(0) }),
        ])}
      />,
    );
    expect(container.querySelector(".transcript-outline")).toBeNull();
    expect(container.querySelector(".transcript-turn-header")).toBeNull();
  });

  test("a flat filter hides the rail", () => {
    const { container } = render(<TranscriptView transcript={twoTurns()} />);
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    expect(container.querySelector(".transcript-outline")).toBeNull();
  });
});

describe("work groups", () => {
  function transcript(entries: TranscriptEntry[]): SessionTranscript {
    return { entries, sourceAvailable: true, truncated: false };
  }

  test("folds a reasoning entry into the adjacent tool cluster", () => {
    const turns = buildTurns([
      entry({ id: "u", kind: "user" }),
      entry({ id: "t1", kind: "tool", title: "Read" }),
      entry({ id: "k", kind: "reasoning", content: "weighing options" }),
      entry({ id: "t2", kind: "tool", title: "Edit" }),
    ]);
    expect(turns[0].blocks.map((block) => block.kind)).toEqual([
      "message",
      "tool-cluster",
    ]);
    expect(blockEntries(turns[0].blocks[1]).map((item) => item.id)).toEqual([
      "t1",
      "k",
      "t2",
    ]);
  });

  test("starts a work group at a reasoning entry that precedes its tools", () => {
    const turns = buildTurns([
      entry({ id: "u", kind: "user" }),
      entry({ id: "k", kind: "reasoning", content: "planning" }),
      entry({ id: "t1", kind: "tool", title: "Read" }),
    ]);
    expect(turns[0].blocks.map((block) => block.kind)).toEqual([
      "message",
      "tool-cluster",
    ]);
  });

  test("keeps an assistant message as its own block between work groups", () => {
    const turns = buildTurns([
      entry({ id: "u", kind: "user" }),
      entry({ id: "t1", kind: "tool", title: "Read" }),
      entry({ id: "a", kind: "assistant", content: "found it" }),
      entry({ id: "t2", kind: "tool", title: "Edit" }),
    ]);
    expect(turns[0].blocks.map((block) => block.kind)).toEqual([
      "message",
      "tool-cluster",
      "message",
      "tool-cluster",
    ]);
  });

  test("still breaks plan markers out of the work group", () => {
    const turns = buildTurns([
      entry({ id: "u", kind: "user" }),
      entry({ id: "t1", kind: "tool", title: "Read" }),
      entry({ id: "m", kind: "tool", title: "TodoWrite" }),
      entry({ id: "k", kind: "reasoning", content: "next" }),
    ]);
    expect(turns[0].blocks.map((block) => block.kind)).toEqual([
      "message",
      "tool-cluster",
      "marker",
      "tool-cluster",
    ]);
  });

  test("counts thoughts alongside tool calls in the group header", () => {
    render(
      <TranscriptView
        transcript={transcript([
          entry({ id: "u", kind: "user", content: "go" }),
          entry({ id: "t1", kind: "tool", title: "Bash" }),
          entry({ id: "t2", kind: "tool", title: "Read" }),
          entry({ id: "k", kind: "reasoning", content: "thinking it over" }),
        ])}
      />,
    );
    expect(screen.getByText("2 tool calls · 1 thought")).toBeInTheDocument();
  });

  test("folds a work group of any size so its rows start hidden", () => {
    const { container } = render(
      <TranscriptView
        transcript={transcript([
          entry({ id: "u", kind: "user", content: "go" }),
          entry({ id: "t1", kind: "tool", title: "Bash" }),
          entry({ id: "t2", kind: "tool", title: "Read" }),
        ])}
      />,
    );
    expect(container.querySelector(".transcript-tool-rows")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "2 tool calls" }));
    expect(container.querySelector(".transcript-tool-rows")).toBeTruthy();
  });

  test("folds a lone entry into a group of its own", () => {
    const { container } = render(
      <TranscriptView
        transcript={transcript([
          entry({ id: "u", kind: "user", content: "go" }),
          entry({ id: "t1", kind: "tool", title: "Bash" }),
        ])}
      />,
    );
    expect(container.querySelector(".transcript-group-toggle")).toBeTruthy();
    expect(container.querySelector(".transcript-tool-rows")).toBeNull();
    expandGroups();
    expect(screen.getByText("Bash")).toBeVisible();
  });
});

describe("outline segments", () => {
  function transcript(entries: TranscriptEntry[]): SessionTranscript {
    return { entries, sourceAvailable: true, truncated: false };
  }

  test("segments a lone turn at its assistant messages", () => {
    const { container } = render(
      <TranscriptView
        transcript={transcript([
          entry({ id: "u", kind: "user", content: "run the sync" }),
          entry({ id: "a1", kind: "assistant", content: "Reading the inbox" }),
          entry({ id: "t1", kind: "tool", title: "Bash" }),
          entry({ id: "a2", kind: "assistant", content: "Updating the sheet" }),
          entry({ id: "t2", kind: "tool", title: "Edit" }),
        ])}
      />,
    );
    expect(container.querySelector(".transcript-outline")).toBeTruthy();
    const labels = [
      ...container.querySelectorAll(".transcript-outline-label"),
    ].map((node) => node.textContent);
    expect(labels).toContain("Reading the inbox");
    expect(labels).toContain("Updating the sheet");
  });

  test("leaves a short lone turn without an outline", () => {
    const { container } = render(
      <TranscriptView
        transcript={transcript([
          entry({ id: "u", kind: "user", content: "hi" }),
          entry({ id: "a1", kind: "assistant", content: "hello" }),
        ])}
      />,
    );
    expect(container.querySelector(".transcript-outline")).toBeNull();
  });
});
