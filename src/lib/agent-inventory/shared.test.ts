import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { parseFrontmatter, readDirectoryEntries } from "./shared";

const dirs: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true })));
});

describe("readDirectoryEntries", () => {
  test("returns child paths for an existing directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shared-test-"));
    dirs.push(dir);
    await mkdir(join(dir, "a"));
    await mkdir(join(dir, "b"));
    const entries = await readDirectoryEntries(dir);
    expect(entries.sort()).toEqual([join(dir, "a"), join(dir, "b")]);
  });

  test("returns empty array for missing directory", async () => {
    expect(
      await readDirectoryEntries(join(tmpdir(), "does-not-exist")),
    ).toEqual([]);
  });
});

describe("parseFrontmatter", () => {
  test("parses name and description from frontmatter", () => {
    const result = parseFrontmatter(
      "---\nname: daily-pr-triage\ndescription: Daily PR check\n---\nBody here\n",
    );
    expect(result.data).toEqual({
      name: "daily-pr-triage",
      description: "Daily PR check",
    });
    expect(result.body).toBe("Body here\n");
  });

  test("returns whole content as body when no frontmatter", () => {
    const result = parseFrontmatter("just body\n");
    expect(result.data).toEqual({});
    expect(result.body).toBe("just body\n");
  });

  test("handles values wrapped in quotes", () => {
    const result = parseFrontmatter('---\nname: "quoted name"\n---\nbody');
    expect(result.data.name).toBe("quoted name");
  });
});
