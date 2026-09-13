import { describe, expect, it } from "vitest";
import { describeCapability } from "./capability-description";

describe("capability descriptions", () => {
  it("does not infer plugin identity from runtime or tool names", () => {
    for (const name of [
      "cua_repl",
      "node_repl",
      "codex_apps",
      "f88be71b-78b5-48e9-b787-7620ef541dcd",
    ])
      expect(describeCapability("mcp", name)).toEqual({ label: name });
  });
  it("uses explicit plugin metadata for any plugin and preserves shared runtime identity", () => {
    const plugin = {
      id: "new-service@market",
      name: "New Service",
      description: "Read the service",
    };
    expect(describeCapability("mcp", "opaque-runtime", [plugin])).toEqual({
      label: "New Service",
      description: "Read the service",
    });
    expect(
      describeCapability("mcp", "node_repl", [
        plugin,
        { id: "browser@market", name: "Browser" },
      ]).label,
    ).toBe("node_repl");
    expect(describeCapability("skill", "my-skill", [plugin])).toEqual({
      label: "my-skill",
    });
  });
});
