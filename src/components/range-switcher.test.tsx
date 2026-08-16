// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { RangeSwitcher } from "./range-switcher";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(cleanup);

describe("RangeSwitcher", () => {
  test("offers 7 days, 30 days, and all time", () => {
    render(<RangeSwitcher range="7d" ariaLabel="Test range" />);

    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["7 days", "30 days", "All time"]);
  });
});
