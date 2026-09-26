import { describe, expect, it } from "vitest";
import type { TranscriptEntry } from "./transcript";
import type { RibbonPoint } from "./trajectory";
import {
  buildRibbonBursts,
  entryDurationMs,
  IDLE_GAP_MS,
  pointOffset,
  shortDuration,
  trajectoryTiming,
} from "./trajectory";

const base = Date.UTC(2026, 8, 24, 20, 0, 0);

function entry(
  offsetMs: number,
  overrides: Partial<TranscriptEntry> = {},
): TranscriptEntry {
  return {
    id: `entry-${offsetMs}`,
    kind: "tool",
    title: "Bash",
    content: null,
    input: null,
    output: null,
    occurredAt: new Date(base + offsetMs).toISOString(),
    completedAt: null,
    isError: false,
    ...overrides,
  };
}

describe("trajectoryTiming", () => {
  it("returns null when fewer than two timestamps exist", () => {
    expect(trajectoryTiming([])).toBeNull();
    expect(trajectoryTiming([entry(0)])).toBeNull();
  });

  it("sums sub-threshold gaps as active time", () => {
    const timing = trajectoryTiming([entry(0), entry(60_000), entry(90_000)]);
    expect(timing).toEqual({
      activeMs: 90_000,
      spanMs: 90_000,
      idleMs: 0,
      idleGaps: 0,
      waitingMs: 0,
    });
  });

  it("excludes idle gaps from active time and counts them", () => {
    const idle = IDLE_GAP_MS * 4;
    const timing = trajectoryTiming([
      entry(0),
      entry(60_000),
      entry(60_000 + idle),
      entry(120_000 + idle),
    ]);
    expect(timing).toEqual({
      activeMs: 120_000,
      spanMs: 120_000 + idle,
      idleMs: idle,
      idleGaps: 1,
      waitingMs: 0,
    });
  });

  it("counts the pause after a finished turn as waiting, not work", () => {
    const timing = trajectoryTiming([
      entry(0, { kind: "user" }),
      entry(60_000),
      entry(90_000, { kind: "assistant" }),
      entry(90_000 + 9 * 60_000, { kind: "user" }),
      entry(120_000 + 9 * 60_000),
    ]);
    expect(timing).toMatchObject({
      activeMs: 120_000,
      waitingMs: 9 * 60_000,
      idleGaps: 0,
    });
  });

  it("counts the pause before a mid-turn interruption as work", () => {
    const timing = trajectoryTiming([
      entry(0, { kind: "user" }),
      entry(60_000),
      entry(5 * 60_000, { kind: "user" }),
    ]);
    expect(timing).toMatchObject({ activeMs: 5 * 60_000, waitingMs: 0 });
  });

  it("still treats a long wait after a finished turn as idle", () => {
    const timing = trajectoryTiming([
      entry(0, { kind: "assistant" }),
      entry(IDLE_GAP_MS * 2, { kind: "user" }),
    ]);
    expect(timing).toMatchObject({ waitingMs: 0, idleGaps: 1 });
  });

  it("treats a gap exactly at the threshold as idle", () => {
    const timing = trajectoryTiming([entry(0), entry(IDLE_GAP_MS)]);
    expect(timing?.activeMs).toBe(0);
    expect(timing?.idleGaps).toBe(1);
  });

  it("uses result timestamps and tolerates out-of-order entries", () => {
    const timing = trajectoryTiming([
      entry(30_000),
      entry(0, { completedAt: new Date(base + 10_000).toISOString() }),
    ]);
    expect(timing?.spanMs).toBe(30_000);
    expect(timing?.activeMs).toBe(30_000);
  });

  it("ignores entries without usable timestamps", () => {
    const timing = trajectoryTiming([
      entry(0),
      entry(0, { id: "bad", occurredAt: "not-a-date" }),
      entry(0, { id: "none", occurredAt: null }),
      entry(5_000),
    ]);
    expect(timing?.activeMs).toBe(5_000);
  });
});

describe("entryDurationMs", () => {
  it("measures a paired call and result", () => {
    expect(
      entryDurationMs(
        entry(0, { completedAt: new Date(base + 2_500).toISOString() }),
      ),
    ).toBe(2_500);
  });

  it("returns null without a result timestamp", () => {
    expect(entryDurationMs(entry(0))).toBeNull();
  });

  it("returns null when the result predates the call", () => {
    expect(
      entryDurationMs(
        entry(5_000, { completedAt: new Date(base).toISOString() }),
      ),
    ).toBeNull();
  });
});

describe("shortDuration", () => {
  it("formats sub-second durations in milliseconds", () => {
    expect(shortDuration(420)).toBe("420ms");
  });

  it("formats seconds with one decimal below ten", () => {
    expect(shortDuration(3_400)).toBe("3.4s");
    expect(shortDuration(42_000)).toBe("42s");
  });

  it("formats minutes with padded seconds", () => {
    expect(shortDuration(125_000)).toBe("2m 05s");
  });

  it("carries a rounded-up remainder into the minute", () => {
    expect(shortDuration(299_600)).toBe("5m 00s");
    expect(shortDuration(59_600)).toBe("1m 00s");
  });

  it("formats hours with padded minutes", () => {
    expect(shortDuration(3_600_000 + 5 * 60_000)).toBe("1h 05m");
  });
});

describe("buildRibbonBursts", () => {
  function point(
    offsetMs: number,
    turnId = "turn-1",
    kind: RibbonPoint["kind"] = "tool",
  ): RibbonPoint {
    return {
      id: `p${offsetMs}`,
      turnId,
      at: base + offsetMs,
      kind,
      label: "Tool call",
    };
  }

  it("returns nothing for no points", () => {
    expect(buildRibbonBursts([])).toEqual([]);
  });

  it("keeps entries closer than the gap in one burst", () => {
    const bursts = buildRibbonBursts([point(0), point(60_000), point(90_000)]);
    expect(bursts).toHaveLength(1);
    expect(bursts[0]).toMatchObject({
      durationMs: 90_000,
      idleBeforeMs: 0,
    });
    expect(bursts[0].points).toHaveLength(3);
  });

  it("splits on an idle gap and records how long it was", () => {
    const idle = IDLE_GAP_MS * 3;
    const bursts = buildRibbonBursts([
      point(0),
      point(30_000),
      point(30_000 + idle),
      point(90_000 + idle),
    ]);
    expect(bursts).toHaveLength(2);
    expect(bursts[0]).toMatchObject({ durationMs: 30_000, idleBeforeMs: 0 });
    expect(bursts[1]).toMatchObject({
      durationMs: 60_000,
      idleBeforeMs: idle,
    });
  });

  it("orders points by time before splitting", () => {
    const bursts = buildRibbonBursts([point(60_000), point(0)]);
    expect(bursts).toHaveLength(1);
    expect(bursts[0].points.map((item) => item.at - base)).toEqual([0, 60_000]);
  });

  it("records the pause after a finished turn as a wait", () => {
    const [burst] = buildRibbonBursts([
      point(0, "turn-1", "user"),
      point(60_000, "turn-1", "assistant"),
      point(60_000 + 9 * 60_000, "turn-2", "user"),
      point(120_000 + 9 * 60_000, "turn-2"),
    ]);
    expect(burst).toMatchObject({
      durationMs: 120_000 + 9 * 60_000,
      waitingMs: 9 * 60_000,
      waits: [{ startMs: base + 60_000, endMs: base + 60_000 + 9 * 60_000 }],
    });
  });

  it("does not record a wait when the user cuts in mid-turn", () => {
    const [burst] = buildRibbonBursts([
      point(0, "turn-1", "user"),
      point(60_000, "turn-1", "tool"),
      point(5 * 60_000, "turn-2", "user"),
    ]);
    expect(burst.waits).toEqual([]);
    expect(burst.waitingMs).toBe(0);
  });

  it("splits inside a turn when the pause is long enough", () => {
    const bursts = buildRibbonBursts([
      point(0, "turn-1"),
      point(IDLE_GAP_MS * 2, "turn-1"),
    ]);
    expect(bursts).toHaveLength(2);
  });
});

describe("pointOffset", () => {
  it("places a point proportionally through its burst", () => {
    const [burst] = buildRibbonBursts([
      { id: "a", turnId: "t", at: base, kind: "tool", label: "" },
      { id: "b", turnId: "t", at: base + 50, kind: "tool", label: "" },
      { id: "c", turnId: "t", at: base + 100, kind: "tool", label: "" },
    ]);
    expect(burst.points.map((item) => pointOffset(burst, item))).toEqual([
      0, 0.5, 1,
    ]);
  });

  it("places every point of an instantaneous burst at the start", () => {
    const [burst] = buildRibbonBursts([
      { id: "a", turnId: "t", at: base, kind: "tool", label: "" },
    ]);
    expect(pointOffset(burst, burst.points[0])).toBe(0);
  });
});
