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
          name: "github:review",
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

  test("keeps disabled plugins, their skills, and disabled MCPs visible with disabled status", async () => {
    const home = await createHome();
    const pluginRoot = join(home, "plugins", "disabled-plugin");
    await skill(pluginRoot, "skills/dormant-skill", "dormant-skill");
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

    // Deliberately-disabled capabilities stay in the inventory with status
    // "disabled" so the comparison can distinguish "turned off on this agent"
    // from "never installed"; command configuration still never leaks.
    expect(codex?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "disabled@openai-curated",
          kind: "plugin",
          status: "disabled",
        }),
        expect.objectContaining({
          name: "disabled:dormant-skill",
          kind: "skill",
          status: "disabled",
        }),
        expect.objectContaining({
          name: "legacy",
          kind: "mcp",
          status: "disabled",
        }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain("legacy-secret");
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
          name: "superpowers:brainstorming",
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

  test("prefers the runtime remote cache for configured Codex marketplace plugins", async () => {
    const home = await createHome();
    const legacyRoot = join(
      home,
      ".codex",
      "plugins",
      "cache",
      "openai-curated",
      "superpowers",
      "legacy-hash",
    );
    const runtimeRoot = join(
      home,
      ".codex",
      "plugins",
      "cache",
      "openai-curated-remote",
      "superpowers",
      "6.2.0",
    );
    await skill(legacyRoot, "skills/legacy-skill", "legacy-skill");
    await skill(runtimeRoot, "skills/runtime-skill", "runtime-skill");
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
          sourcePath: runtimeRoot,
        }),
        expect.objectContaining({
          name: "superpowers:runtime-skill",
          kind: "skill",
          sourcePath: join(runtimeRoot, "skills/runtime-skill"),
        }),
      ]),
    );
    expect(codex?.capabilities).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "superpowers:legacy-skill" }),
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
    const claudeAbsentPlugin = join(home, "claude-absent-plugin");
    await mkdir(claudeAbsentPlugin, { recursive: true });
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
          "disabled-skills@market": false,
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
          "disabled@market": [{ installPath: claudeAbsentPlugin }],
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
          name: "superpowers:claude-tool",
          kind: "skill",
          status: "enabled",
          packaging: "plugin",
          sourcePlugin: "superpowers@claude-plugins-official",
        }),
      ]),
    );
    // A plugin absent from enabledPlugins has an unknown enable state — it
    // must surface as "installed", never silently read as disabled. An
    // explicit `false` is a deliberate disable and stays visible as such.
    expect(claude?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "disabled@market",
          kind: "plugin",
          status: "installed",
        }),
        expect.objectContaining({
          name: "disabled-skills@market",
          kind: "plugin",
          status: "disabled",
        }),
        expect.objectContaining({
          name: "disabled-skills:claude-disabled-tool",
          kind: "skill",
          status: "disabled",
        }),
      ]),
    );
    expect(zcode?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "github@market", status: "enabled" }),
        expect.objectContaining({
          name: "github:zcode-tool",
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
    // Absent from Zcode's enabledPlugins → enable state unknown → "installed".
    expect(zcode?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "disabled-skills@market",
          kind: "plugin",
          status: "installed",
        }),
        expect.objectContaining({
          name: "disabled-skills:zcode-disabled-tool",
          kind: "skill",
          status: "installed",
        }),
      ]),
    );
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
          name: "android-emulator:android-tool",
          kind: "skill",
          status: "installed",
          packaging: "plugin",
          sourcePlugin: "android-emulator@zcode-plugins-official",
        }),
      ]),
    );
  });

  test("warns about stale Zcode cached plugin versions", async () => {
    const home = await createHome();
    const versionRoot = join(
      home,
      ".zcode",
      "cli",
      "plugins",
      "cache",
      "zcode-plugins-official",
      "android-emulator",
    );
    await skill(join(versionRoot, "0.1.0"), "skills/tool", "tool");
    await skill(join(versionRoot, "0.2.0"), "skills/tool", "tool");
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

    expect(zcode?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "stale", sourcePath: versionRoot }),
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
          name: "ios-simulator:ios-tool",
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
          // the dashboard can render the deliberate disable.
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

    // Explicitly-disabled cache-only plugins and their MCP/skill children stay
    // in the inventory with status "disabled" so the comparison can tell a
    // deliberate disable apart from a missing install.
    expect(zcode?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "ios-simulator@zcode-plugins-official",
          kind: "plugin",
          status: "disabled",
        }),
        expect.objectContaining({
          name: "ios-simulator",
          kind: "mcp",
          status: "disabled",
        }),
        expect.objectContaining({
          name: "ios-simulator:ios-tool",
          kind: "skill",
          status: "disabled",
        }),
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
    await mkdir(join(home, "alt-install"), { recursive: true });
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

  test("applies Codex per-skill disables from skills.config entries", async () => {
    const home = await createHome();
    const pluginRoot = join(home, "plugins", "vercel");
    await skill(pluginRoot, "skills/ai-sdk", "ai-sdk");
    await skill(pluginRoot, "skills/chat-sdk", "chat-sdk");
    await skill(
      join(home, ".codex", "skills"),
      "standalone-off",
      "standalone-off",
    );
    await fixture(
      home,
      ".codex/config.toml",
      `[plugins."vercel@openai-curated"]
enabled = true
source = "${pluginRoot}"

[[skills.config]]
name = "vercel:chat-sdk"
enabled = false

[[skills.config]]
name = "standalone-off"
enabled = false
`,
    );

    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: home },
    );
    const codex = result.find((item) => item.provider === "codex");

    // Codex records per-skill disables as [[skills.config]] entries named
    // "<plugin-short-name>:<skill>" (or bare "<skill>" for standalone skills).
    expect(codex?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "vercel:ai-sdk", status: "enabled" }),
        expect.objectContaining({
          name: "vercel:chat-sdk",
          status: "disabled",
        }),
        expect.objectContaining({
          name: "standalone-off",
          status: "disabled",
        }),
      ]),
    );
    // The [[skills.config]] block must not leak into the preceding plugin
    // table's body and disable the plugin itself.
    expect(codex?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "vercel@openai-curated",
          kind: "plugin",
          status: "enabled",
        }),
      ]),
    );
  });

  test("resolves the numerically highest cached plugin version, not the lexicographic one", async () => {
    const home = await createHome();
    const cacheBase = join(
      home,
      ".codex",
      "plugins",
      "cache",
      "openai-curated",
      "versioned",
    );
    await skill(join(cacheBase, "9.0.0"), "skills/old-tool", "old-tool");
    await skill(join(cacheBase, "10.0.0"), "skills/new-tool", "new-tool");
    await fixture(
      home,
      ".codex/config.toml",
      `[plugins."versioned@openai-curated"]
enabled = true
`,
    );

    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: home },
    );
    const codex = result.find((item) => item.provider === "codex");
    const plugin = codex?.capabilities.find(
      (c) => c.name === "versioned@openai-curated",
    );

    expect(plugin?.sourcePath).toBe(join(cacheBase, "10.0.0"));
  });

  test("warns about stale cached plugin versions left behind by re-installs", async () => {
    const home = await createHome();
    const cacheBase = join(
      home,
      ".codex",
      "plugins",
      "cache",
      "openai-curated",
      "versioned",
    );
    await skill(join(cacheBase, "1.0.0"), "skills/tool", "tool");
    await skill(join(cacheBase, "1.1.0"), "skills/tool", "tool");
    await fixture(
      home,
      ".codex/config.toml",
      `[plugins."versioned@openai-curated"]
enabled = true
`,
    );

    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: home },
    );
    const codex = result.find((item) => item.provider === "codex");

    expect(codex?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "stale", sourcePath: cacheBase }),
      ]),
    );
  });

  test("warns about skills.sh lock entries with no installed skill on disk", async () => {
    const home = await createHome();
    const lockPath = await fixture(
      home,
      ".agents/.skill-lock.json",
      JSON.stringify({
        version: 1,
        skills: {
          "ghost-skill": {
            source: "example/ghost-skill",
            sourceType: "github",
          },
        },
      }),
    );

    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: home },
    );
    const codex = result.find((item) => item.provider === "codex");

    expect(codex?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "stale",
          sourcePath: lockPath,
          message: expect.stringContaining("ghost-skill"),
        }),
      ]),
    );
  });

  test("treats an enabled = false line with a trailing comment as disabled", async () => {
    const home = await createHome();
    await fixture(
      home,
      ".codex/config.toml",
      `[mcp_servers.commented]
command = "unused"
enabled = false # temporarily off
`,
    );

    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: home },
    );
    const codex = result.find((item) => item.provider === "codex");
    const server = codex?.capabilities.find((c) => c.name === "commented");

    expect(server?.status).toBe("disabled");
  });

  test("ignores non-server entries in a bare .mcp.json map", async () => {
    const home = await createHome();
    const pluginRoot = join(home, "plugins", "bare");
    await mkdir(pluginRoot, { recursive: true });
    await fixture(
      pluginRoot,
      ".mcp.json",
      JSON.stringify({
        version: 2,
        note: "not a server",
        realServer: { command: "unused" },
      }),
    );
    await fixture(
      home,
      ".codex/config.toml",
      `[plugins."bare@openai-curated"]
enabled = true
source = "${pluginRoot}"
`,
    );

    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: home },
    );
    const codex = result.find((item) => item.provider === "codex");
    const mcpNames = codex?.capabilities
      .filter((c) => c.kind === "mcp")
      .map((c) => c.name);

    expect(mcpNames).toContain("realServer");
    expect(mcpNames).not.toContain("version");
    expect(mcpNames).not.toContain("note");
  });

  test("marks plugins whose install path is missing on disk as unavailable", async () => {
    const home = await createHome();
    await fixture(
      home,
      ".codex/config.toml",
      `[plugins."gone-source@openai-curated"]
enabled = true
source = "${join(home, "deleted-plugin")}"

[plugins."gone-cache@openai-curated"]
enabled = true
`,
    );
    await fixture(
      home,
      ".claude/settings.json",
      JSON.stringify({ enabledPlugins: { "gone@market": true } }),
    );
    await fixture(
      home,
      ".claude/plugins/installed_plugins.json",
      JSON.stringify({
        plugins: {
          "gone@market": [{ installPath: join(home, "deleted-claude-plugin") }],
        },
      }),
    );
    await fixture(
      home,
      ".zcode/cli/config.json",
      JSON.stringify({
        plugins: { enabledPlugins: { "gone@market": true } },
        mcp: { servers: {} },
      }),
    );
    await fixture(
      home,
      ".zcode/cli/plugins/installed_plugins.json",
      JSON.stringify({
        plugins: [
          {
            id: "gone@market",
            installPath: join(home, "deleted-zcode-plugin"),
            marketplace: "market",
          },
        ],
      }),
    );

    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: home },
    );
    const codex = result.find((item) => item.provider === "codex");
    const claude = result.find((item) => item.provider === "claude");
    const zcode = result.find((item) => item.provider === "zcode");

    // A plugin the config still references but whose files are gone is a real
    // problem to surface, not a healthy enabled capability.
    expect(codex?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "gone-source@openai-curated",
          status: "unavailable",
        }),
        expect.objectContaining({
          name: "gone-cache@openai-curated",
          status: "unavailable",
        }),
      ]),
    );
    expect(claude?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "gone@market", status: "unavailable" }),
      ]),
    );
    expect(zcode?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "gone@market", status: "unavailable" }),
      ]),
    );
  });

  test("marks broken skill symlinks inside an enabled plugin as unavailable", async () => {
    const home = await createHome();
    const pluginRoot = join(home, "plugins", "linked");
    await mkdir(join(pluginRoot, "skills"), { recursive: true });
    await symlink(
      join(home, "missing-target"),
      join(pluginRoot, "skills", "broken-plugin-skill"),
    );
    await fixture(
      home,
      ".codex/config.toml",
      `[plugins."linked@openai-curated"]
enabled = true
source = "${pluginRoot}"
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
          name: "linked:broken-plugin-skill",
          status: "unavailable",
        }),
      ]),
    );
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

  test("fingerprints skill content and normalizes whitespace-only instruction differences", async () => {
    const home = await createHome();
    await skill(join(home, ".codex", "skills"), "fp-skill", "fp-skill");
    // Identical instructions apart from line endings and trailing whitespace
    // must produce identical fingerprints so they never read as drift.
    await fixture(home, ".codex/AGENTS.md", "# Shared instructions\n");
    await fixture(home, ".claude/CLAUDE.md", "# Shared instructions \r\n\r\n");

    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: home },
    );
    const codex = result.find((item) => item.provider === "codex");
    const claude = result.find((item) => item.provider === "claude");
    const fpSkill = codex?.capabilities.find((c) => c.name === "fp-skill");

    expect(fpSkill?.contentFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(codex?.instructionFile?.contentFingerprint).toBe(
      claude?.instructionFile?.contentFingerprint,
    );
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

  test("discovers Codex scheduled tasks from automations TOML without leaking args", async () => {
    const home = await createHome();
    await fixture(
      home,
      ".codex/automations/weekly-digest/automation.toml",
      `version = 1
id = "weekly-digest"
kind = "cron"
name = "Weekly digest"
prompt = "Summarize the week. Do not leak SECRET_TOKEN."
status = "ACTIVE"
rrule = "FREQ=WEEKLY;BYDAY=MO;BYHOUR=8;BYMINUTE=0;BYSECOND=0"
model = "gpt-5.5"
execution_environment = "local"
target = { type = "project", project_id = "local-abc123" }
cwds = ["/Users/example/ws"]
created_at = 1783771983978
updated_at = 1783772547499
`,
    );

    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: home },
    );
    const codex = result.find((item) => item.provider === "codex");

    expect(codex?.scheduledTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "weekly-digest",
          name: "Weekly digest",
          scheduleRaw: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=8;BYMINUTE=0;BYSECOND=0",
          scheduleHuman: "Mondays at 8:00 AM",
          scheduleMissing: false,
          status: "active",
          model: "gpt-5.5",
          targetProject: "local-abc123",
          instructionBody: "Summarize the week. Do not leak SECRET_TOKEN.",
          instructionFormat: "toml_prompt",
        }),
      ]),
    );
    // Per the spec's allowlist exception, the prompt body IS surfaced verbatim.
    expect(codex?.scheduledTasks?.[0]?.instructionBody).toContain(
      "SECRET_TOKEN",
    );
  });

  test("maps unknown Codex automation status to unknown", async () => {
    const home = await createHome();
    await fixture(
      home,
      ".codex/automations/odd-job/automation.toml",
      `version = 1
id = "odd-job"
kind = "cron"
name = "Odd job"
prompt = "do thing"
status = "WEIRD"
rrule = "FREQ=DAILY"
`,
    );

    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: home },
    );
    const codex = result.find((item) => item.provider === "codex");
    expect(codex?.scheduledTasks?.[0]?.status).toBe("unknown");
  });

  test("surfaces Codex automation.toml read warnings at the inventory level", async () => {
    const home = await createHome();
    await fixture(
      home,
      ".codex/automations/weekly-digest/automation.toml",
      `id = "weekly-digest"\nname = "Weekly digest"\nrrule = "FREQ=DAILY"\nprompt = "hi"\n`,
    );
    // automation.toml as a directory: readFile throws EISDIR (not ENOENT),
    // so readTextSource pushes an "unreadable" warning instead of skipping silently.
    await mkdir(
      join(home, ".codex", "automations", "broken-task", "automation.toml"),
      { recursive: true },
    );
    // A directory with no automation.toml at all: ENOENT is silent.
    await mkdir(join(home, ".codex", "automations", "missing-task"), {
      recursive: true,
    });

    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: home },
    );
    const codex = result.find((item) => item.provider === "codex");

    expect(codex?.scheduledTasks?.map((t) => t.id) ?? []).toEqual([
      "weekly-digest",
    ]);
    expect(
      (codex?.scheduledTasks ?? []).some((t) => t.id === "broken-task"),
    ).toBe(false);
    expect(
      (codex?.scheduledTasks ?? []).some((t) => t.id === "missing-task"),
    ).toBe(false);
    expect(codex?.warnings).toEqual([
      expect.objectContaining({ code: "unreadable" }),
    ]);
  });

  test("ignores non-directory entries in the Codex automations directory", async () => {
    const home = await createHome();
    await fixture(
      home,
      ".codex/automations/weekly-digest/automation.toml",
      `id = "weekly-digest"\nname = "Weekly digest"\nrrule = "FREQ=DAILY"\nprompt = "hi"\n`,
    );
    // Codex keeps bookkeeping files alongside task directories (the run-jitter
    // salt). Appending automation.toml to one yields ENOTDIR, which must not
    // read as an unreadable provider config.
    await fixture(
      home,
      ".codex/automations/.run-jitter-salt",
      "7dea0077-bbb2-463f-8b62-55b3e3c3aca5",
    );

    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: home },
    );
    const codex = result.find((item) => item.provider === "codex");

    expect(codex?.scheduledTasks?.map((task) => task.id)).toEqual([
      "weekly-digest",
    ]);
    expect(codex?.warnings).toEqual([]);
  });

  test("resolves Codex automation target projects and flags orphaned ones", async () => {
    const home = await createHome();
    await fixture(
      home,
      ".codex/.codex-global-state.json",
      JSON.stringify({
        "local-projects": {
          "local-abc123": {
            id: "local-abc123",
            name: "personal-site",
            rootPaths: ["/Users/example/Projects/personal-site"],
          },
        },
      }),
    );
    await fixture(
      home,
      ".codex/automations/resolved/automation.toml",
      `id = "resolved"\nname = "Resolved"\nrrule = "FREQ=DAILY"\nprompt = "hi"\ntarget = { type = "project", project_id = "local-abc123" }\n`,
    );
    await fixture(
      home,
      ".codex/automations/orphaned/automation.toml",
      `id = "orphaned"\nname = "Orphaned"\nrrule = "FREQ=DAILY"\nprompt = "hi"\ntarget = { type = "project", project_id = "edec41f7-b017-4ae1-9666-9a9bd15e869b" }\n`,
    );

    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: home },
    );
    const tasks = result.find(
      (item) => item.provider === "codex",
    )?.scheduledTasks;
    const resolved = tasks?.find((task) => task.id === "resolved");
    const orphaned = tasks?.find((task) => task.id === "orphaned");

    expect(resolved?.targetProject).toBe("local-abc123");
    expect(resolved?.targetProjectName).toBe("personal-site");
    expect(resolved?.warnings).toEqual([]);

    expect(orphaned?.targetProjectName).toBeUndefined();
    expect(orphaned?.warnings).toEqual([
      expect.objectContaining({ code: "orphaned" }),
    ]);
  });

  test("does not judge Codex automation targets when project state is unreadable", async () => {
    const home = await createHome();
    await fixture(
      home,
      ".codex/automations/orphaned/automation.toml",
      `id = "orphaned"\nname = "Orphaned"\nrrule = "FREQ=DAILY"\nprompt = "hi"\ntarget = { type = "project", project_id = "edec41f7" }\n`,
    );

    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: home },
    );
    const codex = result.find((item) => item.provider === "codex");

    expect(codex?.scheduledTasks?.[0]?.warnings).toEqual([]);
  });

  test("discovers Claude scheduled tasks from scheduled-tasks SKILL.md", async () => {
    const home = await createHome();
    const taskDir = join(home, ".claude", "scheduled-tasks", "daily-pr-triage");
    await mkdir(taskDir, { recursive: true });
    await writeFile(
      join(taskDir, "SKILL.md"),
      "---\nname: daily-pr-triage\ndescription: Daily PR check\n---\nYou are running triage.\n",
    );

    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: home },
    );
    const claude = result.find((item) => item.provider === "claude");

    expect(claude?.scheduledTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "daily-pr-triage",
          name: "daily-pr-triage",
          description: "Daily PR check",
          scheduleMissing: true,
          status: "active",
          instructionFormat: "skill_md",
          instructionBody: "You are running triage.\n",
        }),
      ]),
    );
    expect(claude?.scheduledTasks?.[0]?.scheduleRaw).toBeUndefined();
    expect(claude?.scheduledTasks?.[0]?.scheduleHuman).toBeUndefined();
  });

  test("uses directory name when Claude scheduled-task frontmatter omits name", async () => {
    const home = await createHome();
    const taskDir = join(home, ".claude", "scheduled-tasks", "no-name-task");
    await mkdir(taskDir, { recursive: true });
    await writeFile(
      join(taskDir, "SKILL.md"),
      "---\ndescription: A task with no name field\n---\nBody only.\n",
    );

    const result = await getAgentInventories(
      { kind: "global" },
      { homeDir: home },
    );
    const claude = result.find((item) => item.provider === "claude");
    const task = claude?.scheduledTasks?.find((t) => t.id === "no-name-task");
    expect(task?.name).toBe("no-name-task");
    expect(task?.description).toBe("A task with no name field");
  });

  test("discovers Zcode scheduled tasks from workflow_definition rows", async () => {
    const dbPath = join(tmpdir(), `relay-zcode-tasks-${Date.now()}.sqlite`);
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE workflow_definition (
        id text primary key,
        name text not null,
        source text not null,
        trusted integer not null default 0,
        enabled integer not null default 1,
        script_path text,
        script_hash text not null,
        meta_json text not null,
        time_created integer not null,
        time_updated integer not null,
        scope text not null default 'user'
      );
    `);
    const scriptPath = join(tmpdir(), `relay-zcode-script-${Date.now()}.sh`);
    await writeFile(scriptPath, "#!/bin/sh\necho hello\n");
    db.prepare(
      `INSERT INTO workflow_definition (id, name, source, enabled, script_path, script_hash, meta_json, time_created, time_updated)
       VALUES (?, ?, 'user', 1, ?, 'hash', '{}', 1000, 2000)`,
    ).run("wf-1", "Nightly sync", scriptPath);
    db.close();

    process.env.ZCODE_DB_PATH = dbPath;
    const { __resetZcodeDbCache } = await import("@/lib/zcode-db");
    __resetZcodeDbCache();
    try {
      const result = await getAgentInventories(
        { kind: "global" },
        { homeDir: await createHome() },
      );
      const zcode = result.find((item) => item.provider === "zcode");

      expect(zcode?.scheduledTasks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "wf-1",
            name: "Nightly sync",
            status: "active",
            scheduleMissing: true,
            instructionFormat: "script",
            instructionBody: "#!/bin/sh\necho hello\n",
            sourcePath: scriptPath,
            updatedAt: 2000,
          }),
        ]),
      );
    } finally {
      __resetZcodeDbCache();
      delete process.env.ZCODE_DB_PATH;
      const { rm } = await import("node:fs/promises");
      await rm(dbPath, { force: true });
      await rm(scriptPath, { force: true });
    }
  });
});
