import { describe, expect, test } from "vitest";
import { humanizeSchedule } from "./schedule";

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
