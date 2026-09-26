// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { TranscriptEntry, TranscriptEntryKind } from "@/lib/transcript";
import { IDLE_GAP_MS } from "@/lib/trajectory";
import { buildTurns } from "./transcript-view";
import { TrajectoryRibbon } from "./trajectory-ribbon";

afterEach(cleanup);

const base = Date.UTC(2026, 8, 24, 20, 0, 0);

function entry(
  overrides: Partial<TranscriptEntry> & {
    id: string;
    kind: TranscriptEntryKind;
    offsetMs: number;
  },
): TranscriptEntry {
  const { offsetMs, ...rest } = overrides;
  return {
    title: "Bash",
    content: null,
    input: null,
    output: null,
    occurredAt: new Date(base + offsetMs).toISOString(),
    completedAt: null,
    isError: false,
    ...rest,
  };
}

function renderRibbon(entries: TranscriptEntry[], onSelect = vi.fn()) {
  const result = render(
    <TrajectoryRibbon turns={buildTurns(entries)} onSelect={onSelect} />,
  );
  return { ...result, onSelect };
}

describe("TrajectoryRibbon", () => {
  test("draws one burst per run of work, with the idle gap between them", () => {
    const { container } = renderRibbon([
      entry({ id: "u1", kind: "user", offsetMs: 0, content: "go" }),
      entry({ id: "t1", kind: "tool", offsetMs: 60_000 }),
      entry({
        id: "u2",
        kind: "user",
        offsetMs: 60_000 + IDLE_GAP_MS * 6,
        content: "again",
      }),
      entry({ id: "t2", kind: "tool", offsetMs: 120_000 + IDLE_GAP_MS * 6 }),
    ]);
    expect(container.querySelectorAll(".trajectory-burst")).toHaveLength(2);
    const gaps = container.querySelectorAll(".trajectory-gap");
    expect(gaps).toHaveLength(1);
    expect(gaps[0].textContent).toBe("1h 00m idle");
  });

  test("sizes bursts by the work they hold", () => {
    const { container } = renderRibbon([
      entry({ id: "u1", kind: "user", offsetMs: 0, content: "go" }),
      entry({ id: "t1", kind: "tool", offsetMs: 60_000 }),
      entry({
        id: "u2",
        kind: "user",
        offsetMs: 60_000 + IDLE_GAP_MS * 6,
        content: "again",
      }),
      entry({ id: "t2", kind: "tool", offsetMs: 240_000 + IDLE_GAP_MS * 6 }),
    ]);
    const [first, second] = [
      ...container.querySelectorAll<HTMLElement>(".trajectory-burst"),
    ];
    // 60s of work against 180s.
    expect(Number(first.style.flexGrow)).toBeCloseTo(0.25, 5);
    expect(Number(second.style.flexGrow)).toBeCloseTo(0.75, 5);
  });

  test("colours a tick by what the entry was", () => {
    const { container } = renderRibbon([
      entry({ id: "u1", kind: "user", offsetMs: 0, content: "go" }),
      entry({ id: "r1", kind: "reasoning", offsetMs: 1_000 }),
      entry({ id: "t1", kind: "tool", offsetMs: 2_000, title: "Agent" }),
      entry({ id: "t2", kind: "tool", offsetMs: 3_000, isError: true }),
    ]);
    const kinds = [
      ...container.querySelectorAll<HTMLElement>(".trajectory-tick"),
    ].map((node) => node.dataset.kind);
    expect(kinds).toEqual(["user", "thinking", "subagent", "error"]);
  });

  test("reports the total working time, not the wall clock", () => {
    renderRibbon([
      entry({ id: "u1", kind: "user", offsetMs: 0, content: "go" }),
      entry({ id: "t1", kind: "tool", offsetMs: 60_000 }),
      entry({
        id: "u2",
        kind: "user",
        offsetMs: 60_000 + IDLE_GAP_MS * 6,
        content: "again",
      }),
      entry({ id: "t2", kind: "tool", offsetMs: 120_000 + IDLE_GAP_MS * 6 }),
    ]);
    expect(
      screen.getByText("2m 00s of work across 2 bursts · idle time compressed"),
    ).toBeVisible();
  });

  test("marks the wait after a finished turn and keeps it out of the work", () => {
    const { container } = renderRibbon([
      entry({ id: "u1", kind: "user", offsetMs: 0, content: "go" }),
      entry({ id: "t1", kind: "tool", offsetMs: 30_000 }),
      entry({ id: "a1", kind: "assistant", offsetMs: 60_000, content: "done" }),
      entry({
        id: "u2",
        kind: "user",
        offsetMs: 60_000 + 9 * 60_000,
        content: "again",
      }),
      entry({ id: "t2", kind: "tool", offsetMs: 120_000 + 9 * 60_000 }),
    ]);
    const waits = container.querySelectorAll<HTMLElement>(".trajectory-wait");
    expect(waits).toHaveLength(1);
    // 60s of work, then 9m waiting, then 60s more: the band starts 1/11 in.
    expect(parseFloat(waits[0].style.left)).toBeCloseTo(100 / 11, 3);
    expect(parseFloat(waits[0].style.width)).toBeCloseTo(900 / 11, 3);
    expect(
      screen.getByText("2m 00s of work · 9m 00s waiting on you"),
    ).toBeVisible();
  });

  test("clicking a burst selects the turn nearest the click", () => {
    const { container, onSelect } = renderRibbon([
      entry({ id: "u1", kind: "user", offsetMs: 0, content: "go" }),
      entry({ id: "u2", kind: "user", offsetMs: 100_000, content: "again" }),
    ]);
    const burst = container.querySelector<HTMLElement>(".trajectory-burst");
    if (!burst) throw new Error("no burst rendered");
    burst.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;
    fireEvent.click(burst, { clientX: 95 });
    expect(onSelect).toHaveBeenCalledWith("turn-u2");
    fireEvent.click(burst, { clientX: 2 });
    expect(onSelect).toHaveBeenLastCalledWith("turn-u1");
  });

  test("renders nothing without usable timestamps", () => {
    const { container } = render(
      <TrajectoryRibbon
        turns={buildTurns([
          {
            ...entry({ id: "u1", kind: "user", offsetMs: 0 }),
            occurredAt: null,
          },
        ])}
        onSelect={vi.fn()}
      />,
    );
    expect(container.querySelector(".trajectory-ribbon")).toBeNull();
  });
});
