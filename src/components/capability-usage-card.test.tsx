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
  used: [
    {
      kind: "skill",
      name: "frontend-rules",
      invocations: 2,
      sessionCount: 2,
      lastUsedAt: "2026-07-22T10:00:00Z",
      providers: ["codex", "claude"],
      byProvider: { codex: 1, claude: 1 },
    },
    {
      kind: "mcp",
      name: "github",
      invocations: 4,
      sessionCount: 2,
      lastUsedAt: "2026-07-22T10:05:00Z",
      providers: ["codex", "claude"],
      byProvider: { codex: 3, claude: 1 },
    },
  ],
  unused: Array.from({ length: 9 }, (_, index) => ({
    kind: "skill" as const,
    name: `unused-${index + 1}`,
    providers: ["codex" as const],
    lastUsedAt: null,
    neverObserved: true,
  })),
  installedCount: 11,
  installedUsedCount: 2,
  coverage: [
    { provider: "codex", state: "complete" },
    { provider: "claude", state: "complete" },
    { provider: "zcode", state: "complete" },
    {
      provider: "pi",
      state: "partial",
      message: "Some session sources could not be read.",
    },
  ],
};

function tab(name: RegExp): HTMLElement {
  return screen.getByRole("tab", { name });
}

describe("CapabilityUsageCard", () => {
  test("leads with the adoption ratio and opens on the skills ladder", () => {
    render(<CapabilityUsageCard capabilities={fixtureCapabilities} />);

    expect(
      screen.getByRole("heading", { name: "Capability adoption" }),
    ).toBeVisible();
    expect(
      screen.getByText(/of 11 installed capabilities used · 30 days/),
    ).toBeVisible();
    expect(tab(/Used skills/)).toHaveAttribute("aria-selected", "true");
    expect(tab(/Used skills/)).toBeVisible();
    expect(tab(/Used MCPs/)).toBeVisible();
    expect(screen.getByText("frontend-rules")).toBeVisible();
    expect(screen.queryByText("github")).not.toBeInTheDocument();
    expect(screen.queryByText("unused-1")).not.toBeInTheDocument();
  });

  test("states a bare used count when no provider has complete coverage", () => {
    render(
      <CapabilityUsageCard
        capabilities={{
          ...fixtureCapabilities,
          installedCount: 0,
          installedUsedCount: 0,
        }}
      />,
    );

    expect(screen.getByText(/capabilities used · 30 days/)).toBeVisible();
    expect(
      screen.queryByText(/installed capabilities/),
    ).not.toBeInTheDocument();
  });

  test("counts each tab and scales bars against that tab's own peak", () => {
    render(<CapabilityUsageCard capabilities={fixtureCapabilities} />);

    expect(tab(/Used skills/)).toHaveTextContent("1");
    expect(tab(/Used MCPs/)).toHaveTextContent("1");
    expect(tab(/Unused/)).toHaveTextContent("9");
    expect(
      fixtureCapabilities.used.length + fixtureCapabilities.unused.length,
    ).toBe(fixtureCapabilities.installedCount);

    // frontend-rules (2) tops the skills tab and fills it, even though the
    // MCP tab's github (4) is the larger number.
    expect(
      document.querySelector('.meter i[style*="width: 100%"]'),
    ).not.toBeNull();
  });

  test("writes only non-default tab selection to the URL", () => {
    query = "provider=codex";
    render(<CapabilityUsageCard capabilities={fixtureCapabilities} />);

    fireEvent.click(tab(/Unused/));
    expect(replace).toHaveBeenCalledWith(
      "/insights?provider=codex&capabilityTab=unused",
      { scroll: false },
    );

    replace.mockReset();
    fireEvent.click(tab(/Used skills/));
    expect(replace).toHaveBeenCalledWith("/insights?provider=codex", {
      scroll: false,
    });
  });

  test("renders the unused list and its coverage caveat on the unused tab", () => {
    query = "capabilityTab=unused";
    render(<CapabilityUsageCard capabilities={fixtureCapabilities} />);

    expect(tab(/Unused/)).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("frontend-rules")).not.toBeInTheDocument();

    expect(
      screen.getByText(
        /used skills plus used MCPs plus unused equals the installed total/i,
      ),
    ).toBeVisible();
    const neverObserved = screen.getAllByText(
      "No recorded use in available history",
    );
    expect(neverObserved).toHaveLength(9);
    expect(neverObserved[0]).toBeVisible();
    expect(neverObserved[8]).not.toBeVisible();

    const disclosure = screen.getByText("Show 1 more").closest("details");
    expect(disclosure).toContainElement(screen.getByText("unused-9"));
    fireEvent.click(screen.getByText("Show 1 more"));
    expect(neverObserved[8]).toBeVisible();

    expect(screen.getByText(/Pi/)).toHaveTextContent(
      "Pi coverage partial: Some session sources could not be read.",
    );
  });

  test("crosses capabilities with providers on the by-provider tab", () => {
    query = "capabilityTab=providers";
    render(<CapabilityUsageCard capabilities={fixtureCapabilities} />);

    // Both kinds share the grid, ranked by total across providers.
    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("github");
    expect(rows[2]).toHaveTextContent("frontend-rules");
    expect(rows[1]).toHaveTextContent("4");

    // The grid scales cells against the largest single provider contribution
    // (github on Codex, 3), not the largest total.
    expect(rows[1].querySelector('[title="Codex: 3"]')?.className).toContain(
      "heat-fill-10",
    );
  });

  test("hatches providers whose coverage cannot answer the question", () => {
    query = "capabilityTab=providers";
    render(<CapabilityUsageCard capabilities={fixtureCapabilities} />);

    // Pi is partial and observed nothing — unknown, not a zero. Codex is
    // complete, so its observed zero stays a real zero.
    const row = screen.getAllByRole("row")[2];
    expect(row.querySelector('[title="Pi: coverage incomplete"]')).toHaveClass(
      "is-unknown",
    );
    expect(
      row.querySelector('[title="Zcode: coverage incomplete"]'),
    ).toBeNull();
    expect(row.querySelector('[title="Zcode: 0"]')).toHaveClass("heat-fill-0");
  });

  test("keeps the coverage caveat attached to the unused conclusion", () => {
    render(<CapabilityUsageCard capabilities={fixtureCapabilities} />);

    expect(screen.queryByText(/Pi coverage partial/)).not.toBeInTheDocument();
  });

  test("displays the selected page range without a second range control", () => {
    render(<CapabilityUsageCard capabilities={fixtureCapabilities} />);

    expect(screen.queryByLabelText("Capability usage range")).toBeNull();
    expect(
      screen.getByText(/of 11 installed capabilities used · 30 days/),
    ).toBeVisible();
  });
});
