import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { Sidebar } from "./sidebar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

describe("Sidebar", () => {
  test("uses a narrower desktop rail with tighter menu spacing", () => {
    const globals = readFileSync(
      new URL("../app/globals.css", import.meta.url),
      "utf8",
    );
    const moduleStyles = readFileSync(
      new URL("./sidebar.module.css", import.meta.url),
      "utf8",
    );

    // The shell grid and sidebar sizing tokens stay global.
    expect(globals).toContain("--sidebar-width: 12.5rem;");
    expect(globals).toContain("--sidebar-nav-gap: 0.2rem;");
    expect(globals).toContain(
      "grid-template-columns: var(--sidebar-width) minmax(0, 1fr);",
    );
    // The nav layout itself is co-located in the sidebar module.
    expect(moduleStyles).toContain(`.primaryNav {
  display: grid;
  gap: var(--sidebar-nav-gap);`);
  });

  test("omits the upcoming settings row", () => {
    const html = renderToStaticMarkup(
      <Sidebar connectedAgents={4} sourceErrors={0} />,
    );

    expect(html).not.toContain("Settings");
    expect(html).not.toContain("SOON");
    expect(html).not.toContain("lucide-ellipsis");
    expect(html).toContain("4 agents connected");
    expect(html).toContain("Personal workspace");
  });
});
