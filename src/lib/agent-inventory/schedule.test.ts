import { describe, expect, test } from "vitest";
import {
  compareScheduledTasks,
  humanizeSchedule,
  scheduledTaskSortKey,
} from "./schedule";
import type { ScheduledTask } from "./types";

describe("humanizeSchedule", () => {
  test("weekly single day with time", () => {
    expect(
      humanizeSchedule("FREQ=WEEKLY;BYDAY=MO;BYHOUR=8;BYMINUTE=0;BYSECOND=0"),
    ).toBe("Mondays at 08:00");
  });

  test("weekly multiple days", () => {
    expect(
      humanizeSchedule(
        "FREQ=WEEKLY;BYDAY=MO;BYDAY=WE;BYDAY=FR;BYHOUR=9;BYMINUTE=30",
      ),
    ).toBe("Mondays, Wednesdays, Fridays at 09:30");
  });

  test("daily with time", () => {
    expect(humanizeSchedule("FREQ=DAILY;BYHOUR=0;BYMINUTE=0")).toBe(
      "Daily at 00:00",
    );
  });

  test("monthly with day-of-month and time", () => {
    expect(
      humanizeSchedule("FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=0;BYMINUTE=0"),
    ).toBe("Monthly on day 1 at 00:00");
  });

  test("weekly without time defaults to 00:00", () => {
    expect(humanizeSchedule("FREQ=WEEKLY;BYDAY=MO")).toBe("Mondays at 00:00");
  });

  test("returns undefined for unsupported FREQ", () => {
    expect(humanizeSchedule("FREQ=YEARLY")).toBeUndefined();
  });

  test("returns undefined for unparseable input", () => {
    expect(humanizeSchedule("not-an-rrule")).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    expect(humanizeSchedule("")).toBeUndefined();
  });
});

function task(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "test",
    name: "Test",
    provider: "codex",
    scheduleMissing: false,
    status: "active",
    instructionFormat: "toml_prompt",
    sourcePath: "/safe/test",
    warnings: [],
    ...overrides,
  };
}

describe("scheduledTaskSortKey", () => {
  test("active ranks before inactive", () => {
    const active = task({ status: "active" });
    const paused = task({ status: "paused" });
    expect(scheduledTaskSortKey(active)[0]).toBe(0);
    expect(scheduledTaskSortKey(paused)[0]).toBe(1);
    expect(compareScheduledTasks(active, paused)).toBeLessThan(0);
  });

  test("daily ranks before weekly before monthly", () => {
    const daily = task({ scheduleRaw: "FREQ=DAILY;BYHOUR=2" });
    const weekly = task({ scheduleRaw: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=8" });
    const monthly = task({ scheduleRaw: "FREQ=MONTHLY;BYMONTHDAY=1" });
    expect(scheduledTaskSortKey(daily)[1]).toBe(0);
    expect(scheduledTaskSortKey(weekly)[1]).toBe(1);
    expect(scheduledTaskSortKey(monthly)[1]).toBe(2);
    expect(compareScheduledTasks(daily, weekly)).toBeLessThan(0);
    expect(compareScheduledTasks(weekly, monthly)).toBeLessThan(0);
  });

  test("unknown freq and scheduleMissing rank last (3)", () => {
    const unknown = task({ scheduleRaw: "FREQ=YEARLY" });
    const missing = task({ scheduleMissing: true });
    expect(scheduledTaskSortKey(unknown)[1]).toBe(3);
    expect(scheduledTaskSortKey(missing)[1]).toBe(3);
  });

  test("same frequency sorts by time ascending", () => {
    const early = task({ scheduleRaw: "FREQ=DAILY;BYHOUR=2;BYMINUTE=0" });
    const late = task({ scheduleRaw: "FREQ=DAILY;BYHOUR=18;BYMINUTE=0" });
    expect(scheduledTaskSortKey(early)[2]).toBe(120);
    expect(scheduledTaskSortKey(late)[2]).toBe(1080);
    expect(compareScheduledTasks(early, late)).toBeLessThan(0);
  });

  test("unparseable raw defaults to timeRank 0", () => {
    const t = task({ scheduleRaw: "not-an-rrule" });
    expect(scheduledTaskSortKey(t)[2]).toBe(0);
  });

  test("full ordering: active daily before active weekly before paused daily", () => {
    const activeDaily = task({
      id: "ad",
      scheduleRaw: "FREQ=DAILY;BYHOUR=2",
    });
    const activeWeekly = task({
      id: "aw",
      scheduleRaw: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=8",
    });
    const pausedDaily = task({
      id: "pd",
      scheduleRaw: "FREQ=DAILY;BYHOUR=2",
      status: "paused",
    });
    const sorted = [pausedDaily, activeWeekly, activeDaily].sort(
      compareScheduledTasks,
    );
    expect(sorted.map((t) => t.id)).toEqual(["ad", "aw", "pd"]);
  });
});
