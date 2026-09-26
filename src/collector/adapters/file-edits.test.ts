import { describe, expect, it } from "vitest";
import { fileEditStats } from "./file-edits";

describe("fileEditStats", () => {
  it("returns undefined when a session ran no edit tools", () => {
    expect(
      fileEditStats([
        { name: "Bash", input: { command: "npm test" } },
        { name: "Read", input: { file_path: "src/a.ts" } },
      ]),
    ).toBeUndefined();
  });

  it("counts an Edit as lines out and lines in", () => {
    expect(
      fileEditStats([
        {
          name: "Edit",
          input: {
            file_path: "src/a.ts",
            old_string: "one\ntwo",
            new_string: "one\ntwo\nthree",
          },
        },
      ]),
    ).toEqual({ filesChanged: 1, additions: 3, deletions: 2 });
  });

  it("counts a pure insertion as additions only", () => {
    expect(
      fileEditStats([
        {
          name: "Edit",
          input: { file_path: "src/a.ts", old_string: "", new_string: "added" },
        },
      ]),
    ).toEqual({ filesChanged: 1, additions: 1, deletions: 0 });
  });

  it("counts every edit of a MultiEdit against one file", () => {
    expect(
      fileEditStats([
        {
          name: "MultiEdit",
          input: {
            file_path: "src/a.ts",
            edits: [
              { old_string: "a", new_string: "b" },
              { old_string: "c\nd", new_string: "e" },
            ],
          },
        },
      ]),
    ).toEqual({ filesChanged: 1, additions: 2, deletions: 3 });
  });

  it("counts a Write as the lines it puts in the file", () => {
    expect(
      fileEditStats([
        {
          name: "Write",
          input: { file_path: "src/new.ts", content: "a\nb\n" },
        },
      ]),
    ).toEqual({ filesChanged: 1, additions: 2, deletions: 0 });
  });

  it("counts distinct files once however often they are edited", () => {
    expect(
      fileEditStats([
        { name: "Edit", input: { file_path: "a.ts", new_string: "x" } },
        { name: "Edit", input: { file_path: "a.ts", new_string: "y" } },
        { name: "Edit", input: { file_path: "b.ts", new_string: "z" } },
      ]),
    ).toMatchObject({ filesChanged: 2, additions: 3 });
  });

  it("parses an input that arrives as a JSON string", () => {
    expect(
      fileEditStats([
        {
          name: "Edit",
          input: JSON.stringify({
            file_path: "src/a.ts",
            old_string: "a",
            new_string: "b",
          }),
        },
      ]),
    ).toEqual({ filesChanged: 1, additions: 1, deletions: 1 });
  });

  it("reads files and hunks out of an apply_patch envelope", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: src/a.ts",
      "@@",
      "-const a = 1;",
      "+const a = 2;",
      "+const b = 3;",
      "*** Add File: src/b.ts",
      "+export const b = 1;",
      "*** End Patch",
    ].join("\n");
    expect(fileEditStats([{ name: "apply_patch", input: patch }])).toEqual({
      filesChanged: 2,
      additions: 3,
      deletions: 1,
    });
  });

  it("ignores diff file headers when counting a patch", () => {
    const patch = [
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");
    expect(
      fileEditStats([{ name: "apply_patch", input: patch }]),
    ).toMatchObject({ additions: 1, deletions: 1 });
  });

  it("matches tool names regardless of casing or separators", () => {
    expect(
      fileEditStats([
        { name: "str_replace_editor", input: { path: "a.ts", new_str: "x" } },
      ]),
    ).toMatchObject({ filesChanged: 1, additions: 1 });
  });

  it("still counts an edit whose path is missing", () => {
    expect(
      fileEditStats([{ name: "Edit", input: { new_string: "a\nb" } }]),
    ).toEqual({ filesChanged: 0, additions: 2, deletions: 0 });
  });

  it("skips an unparseable input without discarding the rest", () => {
    expect(
      fileEditStats([
        { name: "Edit", input: 42 },
        { name: "Edit", input: { file_path: "a.ts", new_string: "x" } },
      ]),
    ).toEqual({ filesChanged: 1, additions: 1, deletions: 0 });
  });
});
