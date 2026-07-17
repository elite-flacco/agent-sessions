import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("UsageView", () => {
  test("left-aligns model labels without changing right-aligned costs", () => {
    const styles = readFileSync(
      new URL("../app/globals.css", import.meta.url),
      "utf8",
    );

    expect(styles).toContain(`.dist-row-wide > .mono.dist-label {
    text-align: left;
  }`);
    expect(styles).toContain(`.dist-row .mono {
    text-align: right;`);
  });
});
