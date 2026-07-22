import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { absoluteTime, relativeTime, runtime, shortenHomePath } from "./format";

describe("relativeTime", () => {
  // Mid-afternoon local time so same-day/date boundaries are stable.
  const now = new Date(2026, 6, 15, 14, 30, 0);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows Just now under a minute", () => {
    expect(relativeTime(new Date(2026, 6, 15, 14, 29, 40).toISOString())).toBe(
      "Just now",
    );
  });

  it("shows minutes under an hour", () => {
    expect(relativeTime(new Date(2026, 6, 15, 13, 45, 0).toISOString())).toBe(
      "45m ago",
    );
  });

  it("shows a bare time for earlier the same day", () => {
    const value = relativeTime(new Date(2026, 6, 15, 6, 5, 0).toISOString());
    expect(value).toMatch(/6:05/);
  });

  it("shows a date for the previous calendar day", () => {
    expect(relativeTime(new Date(2026, 6, 14, 20, 53, 0).toISOString())).toBe(
      "Jul 14",
    );
  });

  it("shows a date for anything older", () => {
    expect(relativeTime(new Date(2026, 6, 12, 20, 0, 0).toISOString())).toBe(
      "Jul 12",
    );
  });
});

describe("absoluteTime", () => {
  it("includes date and time", () => {
    const value = absoluteTime(new Date(2026, 6, 14, 20, 53, 0).toISOString());
    expect(value).toMatch(/Jul 14, 2026/);
    expect(value).toMatch(/8:53/);
  });
});

describe("runtime", () => {
  it("drops zero hours", () => {
    expect(runtime(7 * 60_000)).toBe("7m");
  });

  it("keeps hours and minutes", () => {
    expect(runtime(95 * 60_000)).toBe("1h 35m");
  });
});

describe("shortenHomePath", () => {
  const realHome = process.env.HOME;

  beforeEach(() => {
    process.env.HOME = "/Users/example";
  });

  afterEach(() => {
    process.env.HOME = realHome;
  });

  it("replaces the home directory with ~", () => {
    expect(shortenHomePath("/Users/example/.codex/skills/ai-sdk")).toBe(
      "~/.codex/skills/ai-sdk",
    );
  });

  it("leaves non-home paths unchanged", () => {
    expect(shortenHomePath("/opt/agent/skills/ai-sdk")).toBe(
      "/opt/agent/skills/ai-sdk",
    );
  });

  it("collapses plugin-cache version directories", () => {
    expect(
      shortenHomePath(
        "/Users/example/.codex/plugins/cache/openai-curated/vercel/d6169bef/skills/ai-sdk",
      ),
    ).toBe("~/.codex/plugins/cache/openai-curated/vercel/skills/ai-sdk");
  });

  it("leaves the skills.sh install location readable", () => {
    expect(shortenHomePath("/Users/example/.agents/skills/ai-sdk")).toBe(
      "~/.agents/skills/ai-sdk",
    );
  });
});
