import { describe, expect, it } from "vitest";
import { statusDisplay } from "./labels";

describe("statusDisplay", () => {
  it("appends the reason for a failed session", () => {
    expect(statusDisplay("failed", "usage_limit")).toBe("Failed · Usage limit");
    expect(statusDisplay("failed", "network_error")).toBe(
      "Failed · Network error",
    );
  });

  it("relabels needs_attention as awaiting input with no reason", () => {
    expect(statusDisplay("needs_attention")).toBe("Awaiting input");
  });

  it("returns the plain label when no reason is present", () => {
    expect(statusDisplay("completed")).toBe("Completed");
    expect(statusDisplay("interrupted", null)).toBe("Interrupted");
  });
});
