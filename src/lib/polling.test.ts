import { describe, expect, test } from "vitest";
import { DASHBOARD_REFRESH_INTERVAL_MS } from "./polling";

describe("dashboard polling", () => {
  test("refreshes the dashboard every five seconds", () => {
    expect(DASHBOARD_REFRESH_INTERVAL_MS).toBe(5_000);
  });
});
