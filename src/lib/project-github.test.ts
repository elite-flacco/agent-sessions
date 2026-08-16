import { describe, expect, test } from "vitest";
import {
  normalizeGitHubRemote,
  resolveProjectGitHubUrl,
} from "./project-github";

describe("normalizeGitHubRemote", () => {
  test.each([
    ["https://github.com/openai/codex.git", "https://github.com/openai/codex"],
    ["git@github.com:openai/codex.git", "https://github.com/openai/codex"],
    [
      "ssh://git@github.com/openai/codex.git",
      "https://github.com/openai/codex",
    ],
  ])("normalizes recognized GitHub origin %s", (remote, expected) => {
    expect(normalizeGitHubRemote(remote)).toBe(expected);
  });

  test.each([
    "https://token@github.com/openai/codex.git",
    "http://github.com/openai/codex.git",
    "git://github.com/openai/codex.git",
    "git@github.example.com:openai/codex.git",
    "https://github.com/openai/codex/issues",
    "https://github.com/openai",
    "not a remote",
    "",
  ])("rejects unsafe or unsupported origin %s", (remote) => {
    expect(normalizeGitHubRemote(remote)).toBeNull();
  });
});

describe("resolveProjectGitHubUrl", () => {
  const roots = new Map([
    ["/workspace/relay", "/workspace/relay"],
    ["/workspace/relay/src", "/workspace/relay"],
    ["/workspace/relay-worktree", "/workspace/relay-worktree"],
  ]);

  test("returns one canonical URL when every observed root agrees", () => {
    const origins = new Map([
      ["/workspace/relay", "git@github.com:openai/relay.git"],
      ["/workspace/relay-worktree", "https://github.com/openai/relay.git"],
    ]);

    expect(
      resolveProjectGitHubUrl(
        [
          "/workspace/relay",
          "/workspace/relay/src",
          "/workspace/relay-worktree",
        ],
        {
          findRoot: (workdir) => roots.get(workdir) ?? null,
          readOrigin: (root) => origins.get(root) ?? null,
        },
      ),
    ).toBe("https://github.com/openai/relay");
  });

  test("returns no URL when a workdir has no Git root", () => {
    expect(
      resolveProjectGitHubUrl(["/workspace/missing"], {
        findRoot: () => null,
        readOrigin: () => "https://github.com/openai/relay.git",
      }),
    ).toBeNull();
  });

  test("returns no URL when a Git root has no supported GitHub origin", () => {
    expect(
      resolveProjectGitHubUrl(["/workspace/relay"], {
        findRoot: (workdir) => workdir,
        readOrigin: () => "https://gitlab.com/openai/relay.git",
      }),
    ).toBeNull();
  });

  test("returns no URL when observed roots disagree", () => {
    expect(
      resolveProjectGitHubUrl(
        ["/workspace/relay", "/workspace/relay-worktree"],
        {
          findRoot: (workdir) => workdir,
          readOrigin: (root) =>
            root.endsWith("worktree")
              ? "https://github.com/openai/other.git"
              : "https://github.com/openai/relay.git",
        },
      ),
    ).toBeNull();
  });

  test("returns no URL without observed workdirs", () => {
    expect(resolveProjectGitHubUrl([])).toBeNull();
  });
});
