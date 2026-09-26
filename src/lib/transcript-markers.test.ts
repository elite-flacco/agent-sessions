import { describe, expect, it } from "vitest";
import type { TranscriptEntry } from "./transcript";
import {
  markerKind,
  parseDecisions,
  parsePhase,
  parsePlanDiff,
} from "./transcript-markers";

function entry(overrides: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    id: "e1",
    kind: "tool",
    title: "TodoWrite",
    content: null,
    input: null,
    output: null,
    occurredAt: null,
    completedAt: null,
    isError: false,
    ...overrides,
  };
}

describe("markerKind", () => {
  it("recognises plan, decision, and phase tools regardless of casing", () => {
    expect(markerKind(entry({ title: "TodoWrite" }))).toBe("plan");
    expect(markerKind(entry({ title: "update_todos" }))).toBe("plan");
    expect(markerKind(entry({ title: "AskUserQuestion" }))).toBe("decision");
    expect(markerKind(entry({ title: "Skill" }))).toBe("phase");
  });

  it("ignores ordinary tools and non-tool entries", () => {
    expect(markerKind(entry({ title: "Bash" }))).toBeNull();
    expect(markerKind(entry({ kind: "assistant", title: "Skill" }))).toBeNull();
  });
});

describe("parsePlanDiff", () => {
  const previous = [
    { content: "Explore", status: "completed" },
    { content: "Design", status: "in_progress" },
  ];

  it("reports newly completed and newly started work", () => {
    const diff = parsePlanDiff(
      entry({
        output: JSON.stringify({
          oldTodos: previous,
          todos: [
            { content: "Explore", status: "completed" },
            { content: "Design", status: "completed" },
            { content: "Build", status: "in_progress" },
          ],
        }),
      }),
    );
    expect(diff).toEqual({
      completed: ["Design"],
      started: ["Build"],
      added: [],
      done: 2,
      total: 3,
    });
  });

  it("treats the first list as the plan, not as additions", () => {
    const diff = parsePlanDiff(
      entry({
        output: JSON.stringify({
          oldTodos: [],
          todos: [{ content: "Explore", status: "in_progress" }],
        }),
      }),
    );
    expect(diff).toMatchObject({ added: [], started: ["Explore"], total: 1 });
  });

  it("falls back to the input when the result carries no list", () => {
    const diff = parsePlanDiff(
      entry({ input: JSON.stringify({ todos: previous }) }),
    );
    expect(diff).toMatchObject({ done: 1, total: 2 });
  });

  it("lists a new pending item as added, not started", () => {
    const diff = parsePlanDiff(
      entry({
        output: JSON.stringify({
          oldTodos: previous,
          todos: [...previous, { content: "Ship", status: "pending" }],
        }),
      }),
    );
    expect(diff).toMatchObject({ completed: [], started: [], added: ["Ship"] });
  });

  it("returns null for an unparseable or empty payload", () => {
    expect(parsePlanDiff(entry({ input: "not json" }))).toBeNull();
    expect(parsePlanDiff(entry({ input: "{}" }))).toBeNull();
  });
});

describe("parseDecisions", () => {
  it("pairs each question with the answer from the result prose", () => {
    expect(
      parseDecisions(
        entry({
          title: "AskUserQuestion",
          input: JSON.stringify({
            questions: [
              {
                header: "Density",
                question: "How should tool clusters render?",
                options: [{ label: "Collapsed" }, { label: "Expanded" }],
              },
            ],
          }),
          output:
            'User has answered your questions: "How should tool clusters render?"="Collapsed + previews". You can now continue.',
        }),
      ),
    ).toEqual([
      {
        header: "Density",
        question: "How should tool clusters render?",
        answer: "Collapsed + previews",
        optionCount: 2,
      },
    ]);
  });

  it("matches answers across the line breaks the result can contain", () => {
    const [decision] = parseDecisions(
      entry({
        title: "AskUserQuestion",
        input: JSON.stringify({
          questions: [{ question: "How should reasoning blocks render?" }],
        }),
        output:
          'User has answered your questions: "How\n should\n reasoning\n blocks\n render\n?"="Collapsed\n +\n preview".',
      }),
    );
    expect(decision.answer).toBe("Collapsed + preview");
  });

  it("closes the gaps punctuation gains when the payload wraps", () => {
    const [decision] = parseDecisions(
      entry({
        title: "AskUserQuestion",
        input: JSON.stringify({
          questions: [{ question: "How should blocks\n render\n?" }],
        }),
        output: '"How should blocks render?"="Collapsed\n \n(Recommended\n)"',
      }),
    );
    expect(decision.question).toBe("How should blocks render?");
    expect(decision.answer).toBe("Collapsed (Recommended)");
  });

  it("keeps the question when no answer came back", () => {
    const [decision] = parseDecisions(
      entry({
        title: "AskUserQuestion",
        input: JSON.stringify({ questions: [{ question: "Ship it?" }] }),
      }),
    );
    expect(decision).toMatchObject({ question: "Ship it?", answer: null });
  });

  it("recovers pairs from the result when the input is unusable", () => {
    expect(
      parseDecisions(
        entry({
          title: "AskUserQuestion",
          input: "not json",
          output: '"Pick one"="Option A"',
        }),
      ),
    ).toEqual([
      {
        header: null,
        question: "Pick one",
        answer: "Option A",
        optionCount: 0,
      },
    ]);
  });
});

describe("parsePhase", () => {
  it("reads the skill and its arguments", () => {
    expect(
      parsePhase(
        entry({
          title: "Skill",
          input: JSON.stringify({
            skill: "superpowers:brainstorming",
            args: "Improve  readability",
          }),
        }),
      ),
    ).toEqual({
      skill: "superpowers:brainstorming",
      args: "Improve readability",
    });
  });

  it("returns null without a skill name", () => {
    expect(parsePhase(entry({ title: "Skill", input: "{}" }))).toBeNull();
  });
});
