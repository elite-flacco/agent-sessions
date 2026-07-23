// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { CapabilitiesInsight } from "@/lib/queries";
import { CapabilityUsageCard } from "./capability-usage-card";

const replace = vi.fn();
let query = "";

vi.mock("next/navigation", () => ({
  usePathname: () => "/insights",
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(query),
}));

afterEach(() => {
  cleanup();
  replace.mockReset();
  query = "";
});

const fixtureCapabilities: CapabilitiesInsight = {
  range: "30d",
  mostUsed: [
    {
      kind: "skill",
      name: "frontend-rules",
      invocations: 2,
      sessionCount: 2,
      lastUsedAt: "2026-07-22T10:00:00Z",
      providers: ["codex", "claude"],
    },
    {
      kind: "mcp",
      name: "github",
      invocations: 4,
      sessionCount: 2,
      lastUsedAt: "2026-07-22T10:05:00Z",
      providers: ["codex", "claude"],
    },
  ],
  unused: Array.from({ length: 9 }, (_, index) => ({
    kind: "skill" as const,
    name: `unused-${index + 1}`,
    providers: ["codex" as const],
    lastUsedAt: null,
    neverObserved: true,
  })),
  coverage: [
    { provider: "codex", state: "complete" },
    {
      provider: "pi",
      state: "partial",
      message: "Some session sources could not be read.",
    },
  ],
};

describe("CapabilityUsageCard", () => {
  test("renders most-used and unused capability states", () => {
    render(<CapabilityUsageCard capabilities={fixtureCapabilities} />);

    expect(
      screen.getByRole("heading", { name: "Skills & MCP usage" }),
    ).toBeVisible();
    expect(
      screen.getByText("Observed capability calls across coding agents"),
    ).toBeVisible();
    expect(screen.getByText("frontend-rules")).toBeVisible();
    expect(screen.getByText("github")).toBeVisible();
    const neverObserved = screen.getAllByText(
      "Never observed in available history",
    );
    expect(neverObserved).toHaveLength(9);
    expect(neverObserved[0]).toBeVisible();
    expect(neverObserved[8]).not.toBeVisible();
    expect(screen.getByText("2 uses · 2 sessions")).toBeVisible();

    const disclosure = screen
      .getByText("Show all 9 unused capabilities")
      .closest("details");
    expect(disclosure).not.toBeNull();
    expect(disclosure).toContainElement(screen.getByText("unused-9"));
    fireEvent.click(screen.getByText("Show all 9 unused capabilities"));
    expect(neverObserved[8]).toBeVisible();
  });

  test("writes only non-default range selection to the URL", () => {
    query = "provider=codex";
    render(<CapabilityUsageCard capabilities={fixtureCapabilities} />);

    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    expect(replace).toHaveBeenCalledWith(
      "/insights?provider=codex&capabilityRange=7d",
    );
  });

  test("removes the default range from the URL", () => {
    query = "provider=codex&capabilityRange=7d";
    render(
      <CapabilityUsageCard
        capabilities={{ ...fixtureCapabilities, range: "7d" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "30 days" }));
    expect(replace).toHaveBeenCalledWith("/insights?provider=codex");
  });

  test("explains providers omitted by incomplete coverage", () => {
    render(<CapabilityUsageCard capabilities={fixtureCapabilities} />);

    expect(screen.getByText(/Pi/)).toHaveTextContent(
      "Pi coverage partial: Some session sources could not be read.",
    );
  });
});
