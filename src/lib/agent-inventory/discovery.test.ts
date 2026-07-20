import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { getAgentInventories } from "./index";

const homes: string[] = [];

async function createHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "relay-agent-inventory-"));
  homes.push(home);
  return home;
}

async function fixture(
  home: string,
  relativePath: string,
  content: string,
): Promise<string> {
  const path = join(home, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return path;
}

async function skill(
  root: string,
  relativePath: string,
  name: string,
): Promise<string> {
  const directory = join(root, relativePath);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: Test skill\n---\n`,
  );
  return directory;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    homes.splice(0).map((home) => rm(home, { recursive: true })),
  );
});

describe("getAgentInventories", () => {
  test("discovers Codex names and status without leaking MCP configuration", async () => {
    const home = await createHome();
    const pluginRoot = join(home, "plugins", "github");
    await skill(pluginRoot, "skills/review", "review");
    await fixture(
      home,
      ".codex/config.toml",
      `[plugins."github@openai-curated"]
enabled = true
source = "${pluginRoot}"

[mcp_servers.langsmith]
command = "secret-command"
args = ["--token", "secret-token"]

[mcp_servers.langsmith.env]
API_KEY = "secret-value"
`,
    );

    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: home },
    );
    const codex = result.find((item) => item.provider === "codex");
    const serialized = JSON.stringify(result);

    expect(codex?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "github@openai-curated",
          kind: "plugin",
          status: "enabled",
        }),
        expect.objectContaining({
          name: "langsmith",
          kind: "mcp",
          status: "enabled",
          origin: "personal",
        }),
        expect.objectContaining({
          name: "review",
          kind: "skill",
          status: "enabled",
          packaging: "plugin",
          sourcePlugin: "github@openai-curated",
        }),
      ]),
    );
    expect(serialized).not.toContain("secret-command");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("secret-value");
  });

  test("excludes disabled plugins, their skills, and disabled MCPs from the inventory", async () => {
    const home = await createHome();
    const pluginRoot = join(home, "plugins", "disabled-plugin");
    await skill(pluginRoot, "skills/secret-skill", "secret-skill");
    await fixture(
      home,
      ".codex/config.toml",
      `[plugins."disabled@openai-curated"]
enabled = false
source = "${pluginRoot}"

[mcp_servers.legacy]
command = "legacy-secret"
enabled = false
`,
    );

    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: home },
    );
    const codex = result.find((item) => item.provider === "codex");

    expect(
      codex?.capabilities.some((c) => c.name === "disabled@openai-curated"),
    ).toBe(false);
    expect(codex?.capabilities.some((c) => c.name === "secret-skill")).toBe(
      false,
    );
    expect(codex?.capabilities.some((c) => c.name === "legacy")).toBe(false);
  });

  test("resolves Codex plugin skills and MCPs from the cache when source is absent", async () => {
    const home = await createHome();
    const pluginRoot = join(
      home,
      ".codex",
      "plugins",
      "cache",
      "openai-curated",
      "superpowers",
      "d6169bef",
    );
    await skill(pluginRoot, "skills/brainstorming", "brainstorming");
    await fixture(
      pluginRoot,
      ".mcp.json",
      JSON.stringify({ superpowersMcp: { command: "unused" } }),
    );
    await fixture(
      home,
      ".codex/config.toml",
      `[plugins."superpowers@openai-curated"]
enabled = true
`,
    );

    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: home },
    );
    const codex = result.find((item) => item.provider === "codex");

    expect(codex?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "superpowers@openai-curated",
          kind: "plugin",
          status: "enabled",
          sourcePath: pluginRoot,
        }),
        expect.objectContaining({
          name: "brainstorming",
          kind: "skill",
          status: "enabled",
          packaging: "plugin",
          sourcePlugin: "superpowers@openai-curated",
        }),
        expect.objectContaining({
          name: "superpowersMcp",
          kind: "mcp",
          packaging: "plugin",
          sourcePlugin: "superpowers@openai-curated",
        }),
      ]),
    );
  });

  test("distinguishes skills.sh, personal, plugin, and broken global skills", async () => {
    const home = await createHome();
    const sharedSkill = await skill(
      join(home, ".agents", "skills"),
      "agent-browser",
      "agent-browser",
    );
    const personalRoot = join(home, "Projects", "agent-skills");
    const personalSkill = await skill(
      personalRoot,
      "skills/frontend/frontend-rules",
      "frontend-rules",
    );
    await skill(
      join(home, ".codex", "skills"),
      ".system/system-skill",
      "system-skill",
    );
    await mkdir(join(home, ".codex", "skills"), { recursive: true });
    await symlink(sharedSkill, join(home, ".codex", "skills", "agent-browser"));
    await symlink(
      personalSkill,
      join(home, ".codex", "skills", "frontend-rules"),
    );
    await symlink(
      join(home, "missing-skill"),
      join(home, ".codex", "skills", "broken-skill"),
    );
    await fixture(
      home,
      ".agents/.skill-lock.json",
      JSON.stringify({
        version: 1,
        skills: {
          "agent-browser": {
            source: "vercel-labs/agent-browser",
            sourceType: "github",
            sourceUrl: "https://github.com/vercel-labs/agent-browser",
          },
        },
      }),
    );
    await fixture(home, ".codex/AGENTS.md", "# Global Codex instructions\n");

    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: home, personalSkillRoots: [personalRoot] },
    );
    const codex = result.find((item) => item.provider === "codex");

    expect(codex?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "agent-browser",
          origin: "skills_sh",
          sourceRepository: "vercel-labs/agent-browser",
        }),
        expect.objectContaining({
          name: "frontend-rules",
          origin: "personal",
        }),
        expect.objectContaining({
          name: "broken-skill",
          status: "unavailable",
        }),
        expect.objectContaining({
          name: "system-skill",
          origin: "built_in",
          packaging: "built_in",
        }),
      ]),
    );
    expect(codex?.instructionFile).toEqual(
      expect.objectContaining({
        filename: "AGENTS.md",
        content: "# Global Codex instructions\n",
      }),
    );
    expect(codex?.instructionFile?.contentFingerprint).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  test("discovers Claude and Zcode installed plugins with enabled state", async () => {
    const home = await createHome();
    const claudePlugin = join(home, "claude-plugin");
    const claudeDisabledPlugin = join(home, "claude-disabled-plugin");
    const zcodePlugin = join(home, "zcode-plugin");
    const zcodeDisabledPlugin = join(home, "zcode-disabled-plugin");
    await skill(claudePlugin, "skills/claude-tool", "claude-tool");
    await skill(
      claudeDisabledPlugin,
      "skills/claude-disabled-tool",
      "claude-disabled-tool",
    );
    await fixture(
      claudePlugin,
      ".mcp.json",
      JSON.stringify({ pluginMcp: { command: "plugin-secret-command" } }),
    );
    await skill(zcodePlugin, "skills/zcode-tool", "zcode-tool");
    await skill(
      zcodeDisabledPlugin,
      "skills/zcode-disabled-tool",
      "zcode-disabled-tool",
    );
    await fixture(
      home,
      ".claude/settings.json",
      JSON.stringify({
        enabledPlugins: {
          "superpowers@claude-plugins-official": true,
        },
      }),
    );
    await fixture(
      home,
      ".claude/plugins/installed_plugins.json",
      JSON.stringify({
        plugins: {
          "superpowers@claude-plugins-official": [
            { installPath: claudePlugin, version: "1.0.0" },
          ],
          "disabled@market": [{ installPath: join(home, "disabled") }],
          "disabled-skills@market": [
            { installPath: claudeDisabledPlugin, version: "1.0.0" },
          ],
        },
      }),
    );
    await fixture(
      home,
      ".claude.json",
      JSON.stringify({
        mcpServers: { browser: { command: "do-not-return" } },
      }),
    );
    await fixture(
      home,
      ".zcode/cli/config.json",
      JSON.stringify({
        plugins: { enabledPlugins: { "github@market": true } },
        mcp: { servers: { langsmith: { command: "unused" } } },
      }),
    );
    await fixture(
      home,
      ".zcode/cli/plugins/installed_plugins.json",
      JSON.stringify({
        plugins: [
          {
            id: "github@market",
            installPath: zcodePlugin,
            marketplace: "market",
          },
          {
            id: "disabled-skills@market",
            installPath: zcodeDisabledPlugin,
            marketplace: "market",
          },
        ],
      }),
    );

    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: home },
    );
    const claude = result.find((item) => item.provider === "claude");
    const zcode = result.find((item) => item.provider === "zcode");

    expect(claude?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "superpowers@claude-plugins-official",
          status: "enabled",
        }),
        expect.objectContaining({
          name: "browser",
          kind: "mcp",
          origin: "personal",
        }),
        expect.objectContaining({
          name: "pluginMcp",
          kind: "mcp",
          packaging: "plugin",
          sourcePlugin: "superpowers@claude-plugins-official",
        }),
        expect.objectContaining({
          name: "claude-tool",
          kind: "skill",
          status: "enabled",
          packaging: "plugin",
          sourcePlugin: "superpowers@claude-plugins-official",
        }),
      ]),
    );
    // Disabled plugins and their skills/MCPs are excluded from the inventory.
    expect(claude?.capabilities.some((c) => c.name === "disabled@market")).toBe(
      false,
    );
    expect(
      claude?.capabilities.some((c) => c.name === "disabled-skills@market"),
    ).toBe(false);
    expect(
      claude?.capabilities.some((c) => c.name === "claude-disabled-tool"),
    ).toBe(false);
    expect(zcode?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "github@market", status: "enabled" }),
        expect.objectContaining({
          name: "zcode-tool",
          kind: "skill",
          status: "enabled",
          packaging: "plugin",
          sourcePlugin: "github@market",
        }),
        expect.objectContaining({
          name: "langsmith",
          kind: "mcp",
          status: "enabled",
          origin: "personal",
        }),
      ]),
    );
    expect(
      zcode?.capabilities.some((c) => c.name === "disabled-skills@market"),
    ).toBe(false);
    expect(
      zcode?.capabilities.some((c) => c.name === "zcode-disabled-tool"),
    ).toBe(false);
    expect(JSON.stringify(result)).not.toContain("do-not-return");
    expect(JSON.stringify(result)).not.toContain("plugin-secret-command");
  });

  test("surfaces Zcode cache-only marketplace plugins, MCPs, and skills", async () => {
    const home = await createHome();
    const cachePluginRoot = join(
      home,
      ".zcode",
      "cli",
      "plugins",
      "cache",
      "zcode-plugins-official",
      "android-emulator",
      "0.1.0",
    );
    await skill(cachePluginRoot, "skills/android-tool", "android-tool");
    await fixture(
      cachePluginRoot,
      ".mcp.json",
      JSON.stringify({
        mcpServers: { "android-emulator": { command: "unused" } },
      }),
    );
    await fixture(
      home,
      ".zcode/cli/config.json",
      JSON.stringify({ plugins: { enabledPlugins: {} }, mcp: { servers: {} } }),
    );
    await fixture(
      home,
      ".zcode/cli/plugins/installed_plugins.json",
      JSON.stringify({ plugins: [] }),
    );

    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: home },
    );
    const zcode = result.find((item) => item.provider === "zcode");

    // The plugin is in the cache but not in installed_plugins.json or
    // enabledPlugins, so it surfaces as "installed" (present, enabled state
    // unknown) rather than being filtered out as "disabled".
    expect(zcode?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "android-emulator@zcode-plugins-official",
          kind: "plugin",
          status: "installed",
          packaging: "plugin",
          origin: "marketplace",
          sourceRepository: "zcode-plugins-official",
          sourcePath: cachePluginRoot,
        }),
        expect.objectContaining({
          name: "android-emulator",
          kind: "mcp",
          status: "installed",
          packaging: "plugin",
          sourcePlugin: "android-emulator@zcode-plugins-official",
        }),
        expect.objectContaining({
          name: "android-tool",
          kind: "skill",
          status: "installed",
          packaging: "plugin",
          sourcePlugin: "android-emulator@zcode-plugins-official",
        }),
      ]),
    );
  });

  test("marks Zcode cache-only plugins as enabled when listed in enabledPlugins", async () => {
    const home = await createHome();
    const cachePluginRoot = join(
      home,
      ".zcode",
      "cli",
      "plugins",
      "cache",
      "zcode-plugins-official",
      "ios-simulator",
      "0.1.0",
    );
    await skill(cachePluginRoot, "skills/ios-tool", "ios-tool");
    await fixture(
      cachePluginRoot,
      ".mcp.json",
      JSON.stringify({
        mcpServers: { "ios-simulator": { command: "unused" } },
      }),
    );
    await fixture(
      home,
      ".zcode/cli/config.json",
      JSON.stringify({
        plugins: {
          enabledPlugins: { "ios-simulator@zcode-plugins-official": true },
        },
        mcp: { servers: {} },
      }),
    );
    await fixture(
      home,
      ".zcode/cli/plugins/installed_plugins.json",
      JSON.stringify({ plugins: [] }),
    );

    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: home },
    );
    const zcode = result.find((item) => item.provider === "zcode");

    expect(zcode?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "ios-simulator@zcode-plugins-official",
          kind: "plugin",
          status: "enabled",
        }),
        expect.objectContaining({
          name: "ios-simulator",
          kind: "mcp",
          status: "enabled",
          sourcePlugin: "ios-simulator@zcode-plugins-official",
        }),
        expect.objectContaining({
          name: "ios-tool",
          kind: "skill",
          status: "enabled",
          sourcePlugin: "ios-simulator@zcode-plugins-official",
        }),
      ]),
    );
  });

  test("marks Zcode cache-only plugins as disabled when explicitly disabled in enabledPlugins", async () => {
    const home = await createHome();
    const cachePluginRoot = join(
      home,
      ".zcode",
      "cli",
      "plugins",
      "cache",
      "zcode-plugins-official",
      "ios-simulator",
      "0.1.0",
    );
    await skill(cachePluginRoot, "skills/ios-tool", "ios-tool");
    await fixture(
      cachePluginRoot,
      ".mcp.json",
      JSON.stringify({
        mcpServers: { "ios-simulator": { command: "unused" } },
      }),
    );
    await fixture(
      home,
      ".zcode/cli/config.json",
      JSON.stringify({
        plugins: {
          // The plugin is physically cached but explicitly disabled in the UI.
          // The discovery layer must surface "disabled" (not "installed") so
          // getAgentInventories can filter it out of the dashboard.
          enabledPlugins: { "ios-simulator@zcode-plugins-official": false },
        },
        mcp: { servers: {} },
      }),
    );
    await fixture(
      home,
      ".zcode/cli/plugins/installed_plugins.json",
      JSON.stringify({ plugins: [] }),
    );

    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: home },
    );
    const zcode = result.find((item) => item.provider === "zcode");

    // Explicitly-disabled cache-only plugins and their MCP/skill children are
    // filtered out of the public inventory alongside every other disabled
    // capability, so the dashboard never surfaces them as installed.
    expect(zcode?.capabilities).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "ios-simulator@zcode-plugins-official",
        }),
        expect.objectContaining({ name: "ios-simulator", kind: "mcp" }),
        expect.objectContaining({ name: "ios-tool", kind: "skill" }),
      ]),
    );
  });

  test("does not duplicate Zcode plugins that are both installed and cached", async () => {
    const home = await createHome();
    const cachePluginRoot = join(
      home,
      ".zcode",
      "cli",
      "plugins",
      "cache",
      "zcode-plugins-official",
      "shared-plugin",
      "0.1.0",
    );
    await skill(cachePluginRoot, "skills/shared-tool", "shared-tool");
    await fixture(
      cachePluginRoot,
      ".mcp.json",
      JSON.stringify({ mcpServers: { sharedMcp: { command: "unused" } } }),
    );
    // Same plugin id appears in installed_plugins.json with a different
    // installPath; the cache walker must skip it so dedupe stays trivial.
    await fixture(
      home,
      ".zcode/cli/config.json",
      JSON.stringify({
        plugins: {
          enabledPlugins: { "shared-plugin@zcode-plugins-official": true },
        },
        mcp: { servers: {} },
      }),
    );
    await fixture(
      home,
      ".zcode/cli/plugins/installed_plugins.json",
      JSON.stringify({
        plugins: [
          {
            id: "shared-plugin@zcode-plugins-official",
            installPath: join(home, "alt-install"),
            marketplace: "zcode-plugins-official",
          },
        ],
      }),
    );

    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: home },
    );
    const zcode = result.find((item) => item.provider === "zcode");

    const pluginCaps = zcode?.capabilities.filter(
      (c) =>
        c.kind === "plugin" &&
        c.name === "shared-plugin@zcode-plugins-official",
    );
    expect(pluginCaps).toHaveLength(1);
    expect(pluginCaps?.[0]?.sourcePath).toBe(join(home, "alt-install"));
  });

  test("discovers Pi skills, extensions, packages, and global instructions", async () => {
    const home = await createHome();
    await skill(join(home, ".pi", "agent", "skills"), "pi-helper", "pi-helper");
    await fixture(home, ".pi/agent/extensions/logger.ts", "export default {};");
    await fixture(
      home,
      ".pi/agent/settings.json",
      JSON.stringify({
        packages: ["npm:pi-tools", { source: "git:example/pi-kit" }],
      }),
    );
    await fixture(home, ".pi/agent/AGENTS.md", "# Pi instructions\n");

    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: home },
    );
    const pi = result.find((item) => item.provider === "pi");

    expect(pi?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "pi-helper", kind: "skill" }),
        expect.objectContaining({ name: "logger", kind: "plugin" }),
        expect.objectContaining({ name: "npm:pi-tools", kind: "plugin" }),
        expect.objectContaining({ name: "git:example/pi-kit", kind: "plugin" }),
      ]),
    );
    expect(pi?.instructionFile?.filename).toBe("AGENTS.md");
  });

  test("scopes malformed source warnings and continues other discovery", async () => {
    const home = await createHome();
    await fixture(home, ".claude/settings.json", "{malformed");
    await skill(join(home, ".claude", "skills"), "still-found", "still-found");

    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: home },
    );
    const claude = result.find((item) => item.provider === "claude");

    expect(claude?.warnings).toEqual([
      expect.objectContaining({ code: "malformed" }),
    ]);
    expect(claude?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "still-found" }),
      ]),
    );
  });
});
