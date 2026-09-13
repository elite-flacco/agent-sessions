import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { readPluginPresentation } from "./plugin-presentation";

it("reads only display metadata from a discovered plugin manifest", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-presentation-"));
  try {
    await fs.mkdir(path.join(root, ".codex-plugin"));
    const manifest = path.join(root, ".codex-plugin", "plugin.json");
    await fs.writeFile(
      manifest,
      JSON.stringify({
        name: "future-service",
        description: "Fallback description",
        interface: {
          displayName: "Future Service",
          shortDescription: "Connect to future data",
        },
        mcpServers: { server: { env: { SECRET: "PRIVATE_CONFIG" } } },
      }),
    );
    expect(await readPluginPresentation(root, [])).toEqual({
      displayName: "Future Service",
      description: "Connect to future data",
    });
    await fs.writeFile(
      manifest,
      JSON.stringify({
        name: "unified-computer-use",
        description: "App-managed browser automation runtime.",
      }),
    );
    expect(await readPluginPresentation(root, [])).toEqual({
      displayName: "unified-computer-use",
      description: "App-managed browser automation runtime.",
    });
    await fs.writeFile(
      manifest,
      JSON.stringify({
        interface: { displayName: 42 },
        description: { secret: "PRIVATE_CONFIG" },
      }),
    );
    expect(await readPluginPresentation(root, [])).toEqual({});
    await fs.rm(manifest);
    expect(await readPluginPresentation(root, [])).toEqual({});
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
