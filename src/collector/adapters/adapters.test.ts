import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AdapterParseContext,
  CapabilityLookup,
  ProviderAdapter,
} from "@/lib/types";
import { __resetCodexDbCache } from "@/lib/codex-db";
import { zcodeStoredCapabilityUsage } from "../capabilities";
import { claudeAdapter } from "./claude";
import { codexAdapter } from "./codex";
import { piAdapter } from "./pi";
import { zcodeAdapter, __resetZcodeDbCache } from "./zcode";

const temporaryDirectories: string[] = [];

async function fixture(rows: unknown[], partial = false): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "relay-adapter-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "session.jsonl");
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  await fs.writeFile(filePath, partial ? `${body}\n{"partial":` : body);
  return filePath;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

// Isolate the ZCode adapter's DB resolver so tests never read the real
// ~/.zcode database. Point it at a path that cannot exist; the adapter's
// read-only `fileMustExist` open fails gracefully. Tests that exercise the
// enrichment set ZCODE_DB_PATH to their own temp DB.
const ZCODE_DB_GUARD = "/dev/null/nonexistent-zcode-db";
const CODEX_DB_GUARD = "/dev/null/nonexistent-codex-db";
beforeEach(() => {
  process.env.ZCODE_DB_PATH = ZCODE_DB_GUARD;
  process.env.CODEX_STATE_DB_PATH = CODEX_DB_GUARD;
  __resetCodexDbCache();
  __resetZcodeDbCache();
});
afterEach(() => {
  delete process.env.ZCODE_DB_PATH;
  delete process.env.CODEX_STATE_DB_PATH;
  __resetCodexDbCache();
  __resetZcodeDbCache();
});

async function parse(
  adapter: ProviderAdapter,
  rows: unknown[],
  partial = false,
  context?: AdapterParseContext,
) {
  return adapter.parse(await fixture(rows, partial), context);
}

describe("provider adapters", () => {
  it("normalizes Codex metadata, usage, and tools without retaining response bodies", async () => {
    const result = await parse(codexAdapter, [
      {
        type: "session_meta",
        timestamp: "2026-07-11T10:00:00Z",
        payload: {
          id: "codex-1",
          cwd: "/work/relay",
          git: { branch: "codex/feat/relay" },
          model_provider: "openai",
        },
      },
      {
        type: "response_item",
        timestamp: "2026-07-11T10:00:01Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ text: "Build the Relay dashboard" }],
        },
      },
      {
        type: "response_item",
        timestamp: "2026-07-11T10:00:02Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ text: "PRIVATE_RESPONSE_BODY" }],
        },
      },
      {
        type: "response_item",
        timestamp: "2026-07-11T10:00:03Z",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: "SECRET_TOOL_ARGUMENTS",
        },
      },
      {
        type: "event_msg",
        timestamp: "2026-07-11T10:01:00Z",
        payload: {
          type: "token_count",
          info: { total_token_usage: { input_tokens: 100, output_tokens: 40 } },
        },
      },
      {
        type: "event_msg",
        timestamp: "2026-07-11T10:02:00Z",
        payload: { type: "task_complete" },
      },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.sessions[0]).toMatchObject({
      externalId: "codex-1",
      title: "Build the Relay dashboard",
      repository: "relay",
      branch: "codex/feat/relay",
      status: "completed",
    });
    expect(JSON.stringify(result.sessions[0])).not.toContain(
      "PRIVATE_RESPONSE_BODY",
    );
    expect(JSON.stringify(result.sessions[0])).not.toContain(
      "SECRET_TOOL_ARGUMENTS",
    );
  });

  it("reports the Codex model from turn_context when a run produced no usage", async () => {
    const result = await parse(codexAdapter, [
      {
        type: "session_meta",
        timestamp: "2026-07-24T09:00:00Z",
        payload: { id: "codex-noio", cwd: "/work/relay" },
      },
      {
        type: "turn_context",
        timestamp: "2026-07-24T09:00:01Z",
        payload: { model: "gpt-5.5" },
      },
      {
        // A zero-balance failure records a token_count with a null info body,
        // so no usage is extracted, but the model is still knowable.
        type: "event_msg",
        timestamp: "2026-07-24T09:00:02Z",
        payload: { type: "token_count", info: null },
      },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.sessions[0].usage).toEqual([]);
    expect(result.sessions[0].model).toBe("gpt-5.5");
  });

  it("skips harness-injected wrapper blocks when titling Codex sessions", async () => {
    const result = await parse(codexAdapter, [
      {
        type: "session_meta",
        timestamp: "2026-07-11T10:00:00Z",
        payload: { id: "codex-title", cwd: "/work/relay" },
      },
      {
        type: "response_item",
        timestamp: "2026-07-11T10:00:01Z",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              text: "<recommended_plugins>plugin catalog</recommended_plugins>",
            },
          ],
        },
      },
      {
        type: "response_item",
        timestamp: "2026-07-11T10:00:02Z",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              text: '<in-app-browser-context source="ambient-ui-state">This block is automatically supplied by the harness.</in-app-browser-context>',
            },
          ],
        },
      },
      {
        type: "response_item",
        timestamp: "2026-07-11T10:00:03Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ text: "Fix the sidebar layout" }],
        },
      },
    ]);
    expect(result.sessions[0].title).toBe("Fix the sidebar layout");
  });

  it("uses the Codex app database title when it is available", async () => {
    const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-codex-db-"));
    temporaryDirectories.push(dbDir);
    const dbPath = path.join(dbDir, "state_5.sqlite");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT NOT NULL)");
    db.prepare("INSERT INTO threads (id, title) VALUES (?, ?)").run(
      "codex-app-title",
      "Title shown in Codex",
    );
    db.close();
    process.env.CODEX_STATE_DB_PATH = dbPath;

    const result = await parse(codexAdapter, [
      {
        type: "session_meta",
        timestamp: "2026-07-11T10:00:00Z",
        payload: { id: "codex-app-title", cwd: "/work/relay" },
      },
      {
        type: "response_item",
        timestamp: "2026-07-11T10:00:01Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ text: "Original user request" }],
        },
      },
    ]);

    expect(result.sessions[0]?.title).toBe("Title shown in Codex");
  });

  it("uses the task input from a delegated Codex app title", async () => {
    const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-codex-db-"));
    temporaryDirectories.push(dbDir);
    const dbPath = path.join(dbDir, "state_5.sqlite");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT NOT NULL)");
    db.prepare("INSERT INTO threads (id, title) VALUES (?, ?)").run(
      "codex-delegated-title",
      `<codex_delegation>
  <source_thread_id>parent-thread</source_thread_id>
  <input>Redesign Agent Setup Inventory</input>
</codex_delegation>`,
    );
    db.close();
    process.env.CODEX_STATE_DB_PATH = dbPath;

    const result = await parse(codexAdapter, [
      {
        type: "session_meta",
        timestamp: "2026-07-11T10:00:00Z",
        payload: { id: "codex-delegated-title", cwd: "/work/relay" },
      },
      {
        type: "response_item",
        timestamp: "2026-07-11T10:00:01Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ text: "Raw delegated task" }],
        },
      },
    ]);

    expect(result.sessions[0]?.title).toBe("Redesign Agent Setup Inventory");
  });

  it("marks Codex as interrupted only for an explicit abort marker", async () => {
    const result = await parse(codexAdapter, [
      {
        type: "session_meta",
        timestamp: "2026-07-11T10:00:00Z",
        payload: { id: "codex-abort", cwd: "/work/relay" },
      },
      {
        type: "event_msg",
        timestamp: "2026-07-11T10:01:00Z",
        payload: { type: "task_started" },
      },
      {
        type: "event_msg",
        timestamp: "2026-07-11T10:02:00Z",
        payload: { type: "turn_aborted" },
      },
    ]);
    expect(result.sessions[0]).toMatchObject({
      status: "interrupted",
      endedAt: "2026-07-11T10:02:00Z",
    });
  });

  it("preserves Codex subagent parentage and label", async () => {
    const result = await parse(codexAdapter, [
      {
        type: "session_meta",
        timestamp: "2026-07-11T10:00:00Z",
        payload: {
          id: "codex-child",
          cwd: "/work/relay",
          parent_thread_id: "codex-parent",
          agent_nickname: "Scout",
          source: {
            subagent: {
              thread_spawn: {
                parent_thread_id: "codex-parent",
                depth: 1,
              },
            },
          },
        },
      },
      {
        type: "response_item",
        timestamp: "2026-07-11T10:00:01Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ text: "Inspect the data model" }],
        },
      },
    ]);
    expect(result.sessions[0]).toMatchObject({
      externalId: "codex-child",
      parentExternalId: "codex-parent",
      sessionKind: "subagent",
      agentLabel: "Scout",
      agentDepth: 1,
    });
  });

  it("titles a Codex subagent from its agent path when no readable prompt exists", async () => {
    const result = await parse(codexAdapter, [
      {
        type: "session_meta",
        timestamp: "2026-07-18T18:12:17Z",
        payload: {
          id: "codex-task-child",
          cwd: "/work/relay",
          parent_thread_id: "codex-parent",
          agent_nickname: "Parfit",
          agent_path: "/root/task_1_bootstrap",
          source: {
            subagent: {
              thread_spawn: {
                parent_thread_id: "codex-parent",
                depth: 1,
                agent_path: "/root/task_1_bootstrap",
                agent_nickname: "Parfit",
              },
            },
          },
        },
      },
      {
        type: "response_item",
        timestamp: "2026-07-18T18:12:18Z",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "<recommended_plugins>\nHere is a list of plugins.\n</recommended_plugins>",
            },
          ],
        },
      },
    ]);
    expect(result.sessions[0]).toMatchObject({
      externalId: "codex-task-child",
      sessionKind: "subagent",
      title: "Task 1 bootstrap",
    });
  });

  it("normalizes Claude Code and tolerates a partially written final line", async () => {
    const result = await parse(
      claudeAdapter,
      [
        {
          type: "user",
          uuid: "u1",
          sessionId: "claude-1",
          timestamp: "2026-07-11T10:00:00Z",
          cwd: "/work/relay",
          gitBranch: "main",
          message: { role: "user", content: "Fix session filters" },
        },
        {
          type: "assistant",
          uuid: "a1",
          sessionId: "claude-1",
          timestamp: "2026-07-11T10:01:00Z",
          message: {
            role: "assistant",
            model: "claude-opus",
            content: [
              { type: "tool_use", name: "Read", input: { secret: true } },
            ],
          },
        },
        {
          type: "result",
          uuid: "r1",
          sessionId: "claude-1",
          timestamp: "2026-07-11T10:02:00Z",
        },
      ],
      true,
    );
    expect(result.sessions[0]).toMatchObject({
      externalId: "claude-1",
      provider: "claude",
      status: "completed",
    });
    expect(
      result.sessions[0].events.some((event) => event.title === "Used Read"),
    ).toBe(true);
  });

  it("normalizes Claude skill and MCP calls without retaining arguments", async () => {
    const result = await parse(claudeAdapter, [
      {
        type: "user",
        uuid: "u-cap",
        sessionId: "claude-capabilities",
        timestamp: "2026-07-22T10:00:00Z",
        message: { role: "user", content: "Inspect capability use" },
      },
      {
        type: "assistant",
        uuid: "a-skill",
        sessionId: "claude-capabilities",
        timestamp: "2026-07-22T10:01:00Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "skill-call",
              name: "Skill",
              input: { skill: "frontend-rules", args: "SECRET_ARGS" },
            },
            {
              type: "tool_use",
              id: "mcp-call",
              name: "mcp__github__search_prs",
              input: { query: "SECRET_QUERY" },
            },
          ],
        },
      },
    ]);

    expect(result.sessions[0]?.capabilityUsage).toEqual([
      expect.objectContaining({ kind: "skill", name: "frontend-rules" }),
      expect.objectContaining({ kind: "mcp", name: "github" }),
    ]);
    expect(JSON.stringify(result.sessions[0]?.capabilityUsage)).not.toMatch(
      /SECRET_ARGS|SECRET_QUERY/,
    );
  });

  it("ignores Claude SKILL.md reads while retaining native Skill evidence", async () => {
    const lookup: CapabilityLookup = {
      skillFiles: new Map([
        ["/safe/links/frontend-rules/SKILL.md", "frontend-rules"],
      ]),
      mcpNames: new Map(),
    };
    const result = await parse(
      claudeAdapter,
      [
        {
          type: "assistant",
          uuid: "claude-native-and-read",
          sessionId: "claude-native-only",
          timestamp: "2026-07-22T10:01:00Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "claude-native-skill",
                name: "Skill",
                input: { skill: "review-code-changes" },
              },
              {
                type: "tool_use",
                id: "claude-skill-read",
                name: "Read",
                input: { file_path: "/safe/links/frontend-rules/SKILL.md" },
              },
            ],
          },
        },
      ],
      false,
      { capabilities: lookup },
    );

    expect(result.sessions[0]?.capabilityUsage).toEqual([
      expect.objectContaining({
        externalId: "skill:claude-native-skill",
        kind: "skill",
        name: "review-code-changes",
      }),
    ]);
  });

  it("normalizes exact Codex skill reads and namespaced MCP calls", async () => {
    const lookup: CapabilityLookup = {
      skillFiles: new Map([
        ["/safe/links/frontend-rules/SKILL.md", "frontend-rules"],
        ["/safe/source/frontend-rules/SKILL.md", "frontend-rules"],
      ]),
      mcpNames: new Map([["github", "github"]]),
    };
    const result = await parse(
      codexAdapter,
      [
        {
          type: "session_meta",
          timestamp: "2026-07-22T10:00:00Z",
          payload: { id: "codex-capabilities", cwd: "/work/relay" },
        },
        {
          type: "response_item",
          timestamp: "2026-07-22T10:01:00Z",
          payload: {
            type: "function_call",
            call_id: "read-skill",
            name: "exec_command",
            arguments: JSON.stringify({
              cmd: "sed -n '1,240p' /safe/links/frontend-rules/SKILL.md",
            }),
          },
        },
        {
          type: "response_item",
          timestamp: "2026-07-22T10:02:00Z",
          payload: {
            type: "function_call",
            call_id: "github-call",
            namespace: "mcp__codex_apps__github",
            name: "_search_prs",
            arguments: "SECRET_MCP_ARGUMENTS",
          },
        },
        {
          type: "response_item",
          timestamp: "2026-07-22T10:03:00Z",
          payload: {
            type: "function_call",
            call_id: "unmatched-read",
            name: "exec_command",
            arguments: JSON.stringify({ cmd: "cat /tmp/SKILL.md" }),
          },
        },
        {
          type: "response_item",
          timestamp: "2026-07-22T10:04:00Z",
          payload: {
            type: "developer",
            content: "Catalog: /safe/links/frontend-rules/SKILL.md",
          },
        },
        {
          type: "response_item",
          timestamp: "2026-07-22T10:05:00Z",
          payload: {
            type: "function_call",
            call_id: "patch-skill",
            name: "apply_patch",
            arguments: JSON.stringify({
              patch: "*** Update File: /safe/links/frontend-rules/SKILL.md",
            }),
          },
        },
      ],
      false,
      { capabilities: lookup },
    );

    expect(result.sessions[0]?.capabilityUsage).toEqual([
      expect.objectContaining({ kind: "skill", name: "frontend-rules" }),
      expect.objectContaining({ kind: "mcp", name: "github" }),
    ]);
    expect(JSON.stringify(result.sessions[0]?.capabilityUsage)).not.toContain(
      "SECRET_MCP_ARGUMENTS",
    );
  });

  it("normalizes Codex custom tool calls without retaining input", async () => {
    const lookup: CapabilityLookup = {
      skillFiles: new Map([
        ["/safe/links/frontend-rules/SKILL.md", "frontend-rules"],
      ]),
      mcpNames: new Map([["event_stream", "event-stream"]]),
    };
    const result = await parse(
      codexAdapter,
      [
        {
          type: "session_meta",
          timestamp: "2026-07-22T10:00:00Z",
          payload: { id: "codex-custom-capabilities", cwd: "/work/relay" },
        },
        {
          type: "response_item",
          timestamp: "2026-07-22T10:01:00Z",
          id: "custom-row-read",
          payload: {
            type: "custom_tool_call",
            call_id: "custom-read-skill",
            name: "exec_command",
            input:
              "sed -n '1,240p' /safe/links/frontend-rules/SKILL.md && echo SECRET_CUSTOM_INPUT",
          },
        },
        {
          type: "response_item",
          timestamp: "2026-07-22T10:02:00Z",
          payload: {
            type: "custom_tool_call",
            call_id: "custom-event-stream",
            name: "mcp__event_stream__publish",
            input: "SECRET_CUSTOM_MCP_INPUT",
          },
        },
        {
          type: "response_item",
          timestamp: "2026-07-22T10:03:00Z",
          payload: {
            type: "custom_tool_call",
            call_id: "custom-unmatched-read",
            name: "exec_command",
            input: "cat /tmp/SKILL.md",
          },
        },
        {
          type: "response_item",
          timestamp: "2026-07-22T10:04:00Z",
          payload: {
            type: "developer",
            content: "Mention only: /safe/links/frontend-rules/SKILL.md",
          },
        },
      ],
      false,
      { capabilities: lookup },
    );

    expect(result.sessions[0]?.capabilityUsage).toEqual([
      expect.objectContaining({
        externalId: "skill-read:custom-read-skill:frontend-rules",
        kind: "skill",
        name: "frontend-rules",
      }),
      expect.objectContaining({
        externalId: "mcp:custom-event-stream",
        kind: "mcp",
        name: "event-stream",
      }),
    ]);
    expect(JSON.stringify(result.sessions[0]?.capabilityUsage)).not.toMatch(
      /SECRET_CUSTOM_INPUT|SECRET_CUSTOM_MCP_INPUT|custom-unmatched-read/,
    );
    expect(
      result.sessions[0]?.events.filter((event) => event.kind === "tool"),
    ).toHaveLength(3);
    expect(
      result.sessions[0]?.events
        .filter((event) => event.kind === "tool")
        .map((event) => event.externalId),
    ).toEqual([
      "custom-read-skill",
      "custom-event-stream",
      "custom-unmatched-read",
    ]);
  });

  it("skips capability evidence with missing or malformed timestamps", async () => {
    const lookup: CapabilityLookup = {
      skillFiles: new Map([
        ["/safe/links/frontend-rules/SKILL.md", "frontend-rules"],
      ]),
      mcpNames: new Map([["github", "github"]]),
    };
    const contexts = { capabilities: lookup };
    const [claude, codex, pi, zcode] = await Promise.all([
      parse(claudeAdapter, [
        {
          type: "assistant",
          sessionId: "claude-malformed-capability-time",
          timestamp: "not-a-date",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "claude-invalid-time",
                name: "Skill",
                input: { skill: "frontend-rules" },
              },
            ],
          },
        },
      ]),
      parse(
        codexAdapter,
        [
          {
            type: "session_meta",
            timestamp: "2026-07-22T10:00:00Z",
            payload: { id: "codex-malformed-capability-time" },
          },
          {
            type: "response_item",
            timestamp: "invalid",
            payload: {
              type: "custom_tool_call",
              call_id: "codex-invalid-time",
              name: "exec_command",
              input: "cat /safe/links/frontend-rules/SKILL.md",
            },
          },
        ],
        false,
        contexts,
      ),
      parse(
        piAdapter,
        [
          {
            type: "session",
            id: "pi-malformed-capability-time",
            timestamp: "2026-07-22T10:00:00Z",
          },
          {
            type: "message",
            message: {
              role: "assistant",
              content: [
                {
                  type: "toolCall",
                  id: "pi-missing-time",
                  name: "mcp__github__search_prs",
                },
              ],
            },
          },
        ],
        false,
        contexts,
      ),
      parse(zcodeAdapter, [
        {
          type: "model_io",
          sessionId: "zcode-malformed-capability-time",
          startedAt: "not-a-date",
          response: {
            toolCalls: [
              {
                id: "zcode-invalid-time",
                name: "Skill",
                arguments: { skill: "frontend-rules" },
              },
            ],
          },
        },
      ]),
    ]);

    for (const result of [claude, codex, pi, zcode]) {
      expect(result.sessions[0]?.capabilityUsage).toEqual([]);
    }
  });

  it("prefers Claude's latest custom title over generated titles and user messages", async () => {
    const result = await parse(claudeAdapter, [
      {
        type: "user",
        uuid: "u1",
        sessionId: "claude-title",
        timestamp: "2026-07-11T10:00:00Z",
        message: { role: "user", content: "Original user request" },
      },
      {
        type: "ai-title",
        sessionId: "claude-title",
        aiTitle: "Generated session title",
      },
      {
        type: "custom-title",
        sessionId: "claude-title",
        customTitle: "First custom title",
      },
      {
        type: "custom-title",
        sessionId: "claude-title",
        customTitle: "Latest custom title",
      },
    ]);

    expect(result.sessions[0]?.title).toBe("Latest custom title");
  });

  it("uses Claude's latest generated title when no custom title exists", async () => {
    const result = await parse(claudeAdapter, [
      {
        type: "user",
        uuid: "u1",
        sessionId: "claude-ai-title",
        timestamp: "2026-07-11T10:00:00Z",
        message: { role: "user", content: "Original user request" },
      },
      {
        type: "ai-title",
        sessionId: "claude-ai-title",
        aiTitle: "First generated title",
      },
      {
        type: "ai-title",
        sessionId: "claude-ai-title",
        aiTitle: "Latest generated title",
      },
    ]);

    expect(result.sessions[0]?.title).toBe("Latest generated title");
  });

  it("recognizes a current-format Claude end turn as completed", async () => {
    const result = await parse(claudeAdapter, [
      {
        type: "user",
        uuid: "u1",
        sessionId: "claude-current",
        timestamp: "2026-07-11T10:00:00Z",
        message: { role: "user", content: "Explain the status" },
      },
      {
        type: "assistant",
        uuid: "a1",
        sessionId: "claude-current",
        timestamp: "2026-07-11T10:01:00Z",
        message: {
          role: "assistant",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "PRIVATE_RESPONSE_BODY" }],
        },
      },
    ]);
    expect(result.sessions[0]?.status).toBe("completed");
  });

  it("marks Claude rate-limit errors as usage-limit failures", async () => {
    const result = await parse(claudeAdapter, [
      {
        type: "user",
        uuid: "u1",
        sessionId: "claude-rate-limited",
        timestamp: "2026-07-21T23:00:00Z",
        message: { role: "user", content: "Continue the task" },
      },
      {
        type: "assistant",
        uuid: "a1",
        sessionId: "claude-rate-limited",
        timestamp: "2026-07-21T23:01:00Z",
        error: "rate_limit",
        message: {
          role: "assistant",
          stop_reason: "stop_sequence",
          content: [],
        },
      },
    ]);

    expect(result.sessions[0]).toMatchObject({
      status: "failed",
      statusReason: "usage_limit",
    });
  });

  it("uses Claude's agent id for sidechains and links them to the main session", async () => {
    const result = await parse(claudeAdapter, [
      {
        type: "user",
        uuid: "u1",
        sessionId: "claude-parent",
        agentId: "agent-child",
        isSidechain: true,
        timestamp: "2026-07-11T10:00:00Z",
        message: { role: "user", content: "Fix the child task" },
      },
    ]);
    expect(result.sessions[0]).toMatchObject({
      externalId: "agent-child",
      parentExternalId: "claude-parent",
      sessionKind: "subagent",
      agentLabel: "agent-child",
      agentDepth: 1,
    });
  });

  it("marks a stale trailing Claude user message as incomplete", async () => {
    const result = await parse(claudeAdapter, [
      {
        type: "user",
        uuid: "u1",
        sessionId: "claude-unanswered",
        timestamp: "2020-01-01T10:00:00Z",
        message: { role: "user", content: "Are you still there?" },
      },
    ]);
    expect(result.sessions[0]?.status).toBe("incomplete");
  });

  it("normalizes Pi lifecycle records", async () => {
    const result = await parse(piAdapter, [
      {
        type: "session",
        id: "pi-1",
        timestamp: "2026-07-11T10:00:00Z",
        cwd: "/work/relay",
      },
      {
        type: "model_change",
        id: "m1",
        parentId: "pi-1",
        timestamp: "2026-07-11T10:00:01Z",
        modelId: "gpt-5",
        provider: "openai",
      },
      {
        type: "message",
        id: "u1",
        parentId: "pi-1",
        timestamp: "2026-07-11T10:00:02Z",
        message: { role: "user", content: "Inspect local sessions" },
      },
      {
        type: "message",
        id: "a1",
        parentId: "pi-1",
        timestamp: "2026-07-11T10:00:03Z",
        message: {
          role: "assistant",
          model: "gpt-5",
          content: [{ type: "text", text: "PRIVATE_RESPONSE_BODY" }],
          usage: { input: 100, output: 20 },
        },
      },
      { type: "session_end", id: "end", timestamp: "2026-07-11T10:05:00Z" },
    ]);
    expect(result.sessions[0]).toMatchObject({
      externalId: "pi-1",
      title: "Inspect local sessions",
      status: "completed",
    });
    expect(result.sessions[0].model).toBe("gpt-5");
  });

  it("recognizes a Pi assistant stop as a completed turn", async () => {
    const timestamp = new Date().toISOString();
    const result = await parse(piAdapter, [
      {
        type: "session",
        id: "pi-stopped",
        timestamp,
        cwd: "/work/relay",
      },
      {
        type: "message",
        id: "u1",
        timestamp,
        message: { role: "user", content: "Inspect local sessions" },
      },
      {
        type: "message",
        id: "a1",
        timestamp,
        message: {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "PRIVATE_RESPONSE_BODY" }],
        },
      },
    ]);

    expect(result.sessions[0]?.status).toBe("completed");
  });

  it("normalizes Pi exact skill reads and namespaced MCP calls", async () => {
    const lookup: CapabilityLookup = {
      skillFiles: new Map([
        ["/safe/links/frontend-rules/SKILL.md", "frontend-rules"],
      ]),
      mcpNames: new Map(),
    };
    const result = await parse(
      piAdapter,
      [
        {
          type: "session",
          id: "pi-capabilities",
          timestamp: "2026-07-22T10:00:00Z",
        },
        {
          type: "message",
          id: "pi-call-row",
          timestamp: "2026-07-22T10:01:00Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "pi-read",
                name: "read",
                arguments: { path: "/safe/links/frontend-rules/SKILL.md" },
              },
              {
                type: "toolCall",
                id: "pi-mcp",
                namespace: "mcp__codex_apps__github",
                name: "_search_prs",
                arguments: { query: "SECRET_PI_QUERY" },
              },
            ],
          },
        },
      ],
      false,
      { capabilities: lookup },
    );

    expect(result.sessions[0]?.capabilityUsage).toEqual([
      expect.objectContaining({ kind: "skill", name: "frontend-rules" }),
      expect.objectContaining({ kind: "mcp", name: "github" }),
    ]);
    expect(JSON.stringify(result.sessions[0]?.capabilityUsage)).not.toContain(
      "SECRET_PI_QUERY",
    );
  });

  it("normalizes Zcode model I/O without storing request or response bodies", async () => {
    const result = await parse(zcodeAdapter, [
      {
        type: "model_io",
        sessionId: "z-1",
        turnId: "t1",
        startedAt: "2026-07-11T10:00:00Z",
        completedAt: "2026-07-11T10:01:00Z",
        model: "gpt-5",
        request: { content: "Plan the collector" },
        response: { content: "PRIVATE_ZCODE_RESPONSE" },
      },
    ]);
    expect(result.sessions[0]).toMatchObject({
      externalId: "z-1",
      title: "Plan the collector",
      provider: "zcode",
      status: "completed",
    });
    expect(JSON.stringify(result.sessions[0])).not.toContain(
      "PRIVATE_ZCODE_RESPONSE",
    );
  });

  it("normalizes Zcode Skill and MCP calls without retaining inputs", async () => {
    const lookup: CapabilityLookup = {
      skillFiles: new Map(),
      mcpNames: new Map([
        ["plugin_openai-developers_openaideveloperdocs", "openaiDeveloperDocs"],
      ]),
    };
    const result = await parse(
      zcodeAdapter,
      [
        {
          type: "model_io",
          sessionId: "z-capabilities",
          turnId: "turn-capabilities",
          startedAt: "2026-07-22T10:00:00Z",
          completedAt: "2026-07-22T10:01:00Z",
          request: {
            messages: [
              {
                role: "assistant",
                toolCalls: [
                  {
                    id: "z-skill",
                    name: "Skill",
                    arguments: {
                      skill: "review-code-changes",
                      args: "SECRET_ZCODE_ARGS",
                    },
                  },
                  {
                    id: "z-mcp",
                    name: "mcp__plugin_openai-developers_openaiDeveloperDocs__search_openai_docs",
                    arguments: { query: "SECRET_ZCODE_QUERY" },
                  },
                ],
              },
            ],
          },
        },
      ],
      false,
      { capabilities: lookup },
    );

    expect(result.sessions[0]?.capabilityUsage).toEqual([
      expect.objectContaining({ kind: "skill", name: "review-code-changes" }),
      expect.objectContaining({ kind: "mcp", name: "openaiDeveloperDocs" }),
    ]);
    expect(JSON.stringify(result.sessions[0]?.capabilityUsage)).not.toMatch(
      /SECRET_ZCODE_ARGS|SECRET_ZCODE_QUERY/,
    );
  });

  it("ignores Zcode rollout SKILL.md reads while retaining native Skill evidence", async () => {
    const lookup: CapabilityLookup = {
      skillFiles: new Map([
        ["/safe/links/frontend-rules/SKILL.md", "frontend-rules"],
      ]),
      mcpNames: new Map(),
    };
    const result = await parse(
      zcodeAdapter,
      [
        {
          type: "model_io",
          sessionId: "z-native-only",
          startedAt: "2026-07-22T10:00:00Z",
          completedAt: "2026-07-22T10:01:00Z",
          request: {
            messages: [
              {
                role: "assistant",
                toolCalls: [
                  {
                    id: "z-native-skill",
                    name: "Skill",
                    arguments: { skill: "systematic-debugging" },
                  },
                  {
                    id: "z-skill-read",
                    name: "read",
                    arguments: {
                      path: "/safe/links/frontend-rules/SKILL.md",
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
      false,
      { capabilities: lookup },
    );

    expect(result.sessions[0]?.capabilityUsage).toEqual([
      expect.objectContaining({
        externalId: "skill:z-native-skill",
        kind: "skill",
        name: "systematic-debugging",
      }),
    ]);
  });

  it("normalizes authoritative Zcode database capability usage safely", () => {
    const capabilityUsage = zcodeStoredCapabilityUsage(
      [
        {
          id: "message-1",
          timeCreated: 1_750_000_000_000,
          data: { role: "assistant" },
          parts: [
            {
              id: "skill-part",
              timeCreated: 1_750_000_000_100,
              data: {
                type: "tool",
                tool: "Skill",
                state: {
                  input: {
                    skill: "systematic-debugging",
                    args: "PRIVATE_SKILL_INPUT",
                  },
                  output: "PRIVATE_SKILL_OUTPUT",
                },
              },
            },
            {
              id: "unsafe-part",
              timeCreated: 1_750_000_000_200,
              data: {
                type: "text",
                tool: "Skill",
                state: { input: { skill: "must-not-appear" } },
              },
            },
          ],
        },
      ],
      [
        {
          toolCallId: "mcp-call",
          toolName:
            "mcp__plugin_openai-developers_openaiDeveloperDocs__search_openai_docs",
          startedAt: 1_750_000_000_300,
        },
        {
          toolCallId: "plain-call",
          toolName: "read",
          startedAt: 1_750_000_000_400,
        },
      ],
      {
        skillFiles: new Map(),
        mcpNames: new Map([
          [
            "plugin_openai-developers_openaideveloperdocs",
            "openaiDeveloperDocs",
          ],
        ]),
      },
    );

    expect(capabilityUsage).toEqual([
      {
        externalId: "skill:skill-part",
        kind: "skill",
        name: "systematic-debugging",
        occurredAt: new Date(1_750_000_000_100).toISOString(),
      },
      {
        externalId: "mcp:mcp-call",
        kind: "mcp",
        name: "openaiDeveloperDocs",
        occurredAt: new Date(1_750_000_000_300).toISOString(),
      },
    ]);
    expect(JSON.stringify(capabilityUsage)).not.toMatch(
      /PRIVATE_SKILL_INPUT|PRIVATE_SKILL_OUTPUT|must-not-appear|plain-call/,
    );
  });

  it("skips malformed authoritative Zcode database capability timestamps", () => {
    const capabilityUsage = zcodeStoredCapabilityUsage(
      [
        {
          id: "message-invalid-time",
          timeCreated: Number.NaN,
          data: { role: "assistant" },
          parts: [
            {
              id: "skill-invalid-time",
              timeCreated: Number.NaN,
              data: {
                type: "tool",
                tool: "Skill",
                state: { input: { skill: "systematic-debugging" } },
              },
            },
          ],
        },
      ],
      [
        {
          toolCallId: "mcp-invalid-time",
          toolName: "mcp__github__search_prs",
          startedAt: Number.NaN,
        },
      ],
    );

    expect(capabilityUsage).toEqual([]);
  });

  it("normalizes Zcode capability calls found only in a model response", async () => {
    const result = await parse(zcodeAdapter, [
      {
        type: "model_io",
        sessionId: "z-response-capabilities",
        startedAt: "2026-07-22T10:00:00Z",
        completedAt: "2026-07-22T10:01:00Z",
        request: { messages: [] },
        response: {
          toolCalls: [
            {
              id: "z-response-skill",
              name: "Skill",
              arguments: {
                skill: "review-code-changes",
                args: "SECRET_RESPONSE_ARGS",
              },
            },
          ],
        },
      },
    ]);

    expect(result.sessions[0]?.capabilityUsage).toEqual([
      expect.objectContaining({ kind: "skill", name: "review-code-changes" }),
    ]);
    expect(JSON.stringify(result.sessions[0]?.capabilityUsage)).not.toContain(
      "SECRET_RESPONSE_ARGS",
    );
  });

  it("deduplicates echoed Zcode request and response calls by stable call id", async () => {
    const echoedCall = {
      id: "z-echoed-call",
      name: "mcp__openaiDeveloperDocs__search_openai_docs",
      arguments: { query: "SECRET_ECHO_QUERY" },
    };
    const result = await parse(zcodeAdapter, [
      {
        type: "model_io",
        sessionId: "z-echoed-capability",
        startedAt: "2026-07-22T10:00:00Z",
        completedAt: "2026-07-22T10:01:00Z",
        request: { messages: [{ role: "assistant", toolCalls: [echoedCall] }] },
        response: { toolCalls: [echoedCall] },
      },
    ]);

    expect(result.sessions[0]?.capabilityUsage).toEqual([
      expect.objectContaining({
        externalId: "mcp:z-echoed-call",
        kind: "mcp",
        name: "openaideveloperdocs",
      }),
    ]);
    expect(JSON.stringify(result.sessions[0]?.capabilityUsage)).not.toContain(
      "SECRET_ECHO_QUERY",
    );
  });

  it("uses explicit Zcode cancellation and failure statuses", async () => {
    const cancelled = await parse(zcodeAdapter, [
      {
        sessionId: "z-cancelled",
        timestamp: "2026-07-11T10:00:00Z",
        status: "cancelled",
      },
    ]);
    const failed = await parse(zcodeAdapter, [
      {
        sessionId: "z-failed",
        timestamp: "2026-07-11T10:00:00Z",
        status: "failed",
      },
    ]);
    expect(cancelled.sessions[0]?.status).toBe("interrupted");
    expect(failed.sessions[0]?.status).toBe("failed");
    expect(failed.sessions[0]?.statusReason).toBe("execution_error");
  });

  it("resolves the Zcode workspace from Zcode's session DB when the rollout omits cwd", async () => {
    const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-zcode-db-"));
    temporaryDirectories.push(dbDir);
    const dbPath = path.join(dbDir, "db.sqlite");
    const db = new Database(dbPath);
    db.exec(
      "CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT NOT NULL, title TEXT NOT NULL)",
    );
    db.prepare(
      "INSERT INTO session (id, directory, title) VALUES (?, ?, ?)",
    ).run("z-1", "/projects/relay-demo", "Build the session inspector");
    db.close();
    process.env.ZCODE_DB_PATH = dbPath;
    __resetZcodeDbCache();

    const result = await parse(zcodeAdapter, [
      {
        type: "model_io",
        sessionId: "z-1",
        turnId: "t1",
        startedAt: "2026-07-11T10:00:00Z",
        completedAt: "2026-07-11T10:01:00Z",
        model: "gpt-5",
        request: { content: "Plan the collector" },
        response: { content: "PRIVATE_ZCODE_RESPONSE" },
      },
    ]);
    const session = result.sessions[0];
    expect(session?.cwd).toBe("/projects/relay-demo");
    expect(session?.repository).toBe("relay-demo");
    expect(session?.summary).toBe("Zcode session in relay-demo.");
    expect(session?.title).toBe("Build the session inspector");
  });

  it("leaves the Zcode workspace unknown when the session id is absent from the DB", async () => {
    const result = await parse(zcodeAdapter, [
      {
        type: "model_io",
        sessionId: "z-missing",
        startedAt: "2026-07-11T10:00:00Z",
        completedAt: "2026-07-11T10:01:00Z",
        model: "gpt-5",
        request: { content: "Hello" },
      },
    ]);
    const session = result.sessions[0];
    expect(session?.cwd).toBeUndefined();
    expect(session?.repository).toBeUndefined();
    expect(session?.summary).toBe("Zcode session in an unknown workspace.");
  });

  it("accumulates Claude usage per model and counts each message once", async () => {
    const assistantRow = (
      uuid: string,
      id: string,
      model: string,
      usage: Record<string, number>,
    ) => ({
      type: "assistant",
      uuid,
      sessionId: "claude-usage",
      timestamp: "2026-07-11T10:01:00Z",
      message: { role: "assistant", id, model, usage },
    });
    const result = await parse(claudeAdapter, [
      assistantRow("a1", "msg_1", "claude-fable-5", {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 200,
      }),
      // Streaming repeats the same message id — must not double count.
      assistantRow("a2", "msg_1", "claude-fable-5", {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 200,
      }),
      assistantRow("a3", "msg_2", "claude-sonnet-5", {
        input_tokens: 10,
        output_tokens: 5,
      }),
      assistantRow("a4", "msg_3", "<synthetic>", { input_tokens: 999 }),
    ]);
    expect(result.sessions[0].usage).toEqual([
      {
        model: "claude-fable-5",
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 1000,
        cacheWriteTokens: 200,
      },
      {
        model: "claude-sonnet-5",
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    ]);
    expect(result.sessions[0].model).toBe("claude-fable-5");
  });

  it("normalizes cumulative Codex usage and attributes it to the turn model", async () => {
    const result = await parse(codexAdapter, [
      {
        type: "session_meta",
        timestamp: "2026-07-11T10:00:00Z",
        payload: { id: "codex-usage", model_provider: "openai" },
      },
      {
        type: "turn_context",
        timestamp: "2026-07-11T10:00:01Z",
        payload: { model: "gpt-5.5" },
      },
      {
        type: "event_msg",
        timestamp: "2026-07-11T10:00:02Z",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 500,
              cached_input_tokens: 100,
              output_tokens: 40,
            },
          },
        },
      },
      {
        type: "event_msg",
        timestamp: "2026-07-11T10:01:00Z",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 1000,
              cached_input_tokens: 800,
              output_tokens: 90,
              reasoning_output_tokens: 30,
            },
          },
        },
      },
    ]);
    // Last cumulative total wins; cached tokens are a subset of input.
    expect(result.sessions[0].usage).toEqual([
      {
        model: "gpt-5.5",
        inputTokens: 200,
        outputTokens: 90,
        cacheReadTokens: 800,
        cacheWriteTokens: 0,
      },
    ]);
    expect(result.sessions[0].model).toBe("gpt-5.5");
  });

  it("sums Pi reported cost alongside normalized usage", async () => {
    const result = await parse(piAdapter, [
      {
        type: "session",
        id: "pi-cost",
        timestamp: "2026-07-11T10:00:00Z",
        cwd: "/work/relay",
      },
      {
        type: "message",
        id: "a1",
        timestamp: "2026-07-11T10:00:01Z",
        message: {
          role: "assistant",
          model: "z-ai/glm-5.2",
          content: [],
          usage: {
            input: 100,
            output: 10,
            cacheRead: 50,
            cacheWrite: 0,
            cost: { total: 0.002 },
          },
        },
      },
      {
        type: "message",
        id: "a2",
        timestamp: "2026-07-11T10:00:02Z",
        message: {
          role: "assistant",
          model: "z-ai/glm-5.2",
          content: [],
          usage: {
            input: 200,
            output: 20,
            cacheRead: 100,
            cacheWrite: 0,
            cost: { total: 0.003 },
          },
        },
      },
    ]);
    expect(result.sessions[0].usage).toEqual([
      {
        model: "z-ai/glm-5.2",
        inputTokens: 300,
        outputTokens: 30,
        cacheReadTokens: 150,
        cacheWriteTokens: 0,
        reportedCostUsd: 0.005,
      },
    ]);
  });

  it("normalizes Zcode camelCase usage where input includes cache tokens", async () => {
    const result = await parse(zcodeAdapter, [
      {
        type: "model_io",
        sessionId: "z-usage",
        startedAt: "2026-07-11T10:00:00Z",
        completedAt: "2026-07-11T10:01:00Z",
        model: { modelId: "GLM-5.2", providerId: "builtin:zai-coding-plan" },
        response: {
          usage: {
            inputTokens: 1000,
            outputTokens: 50,
            cacheReadTokens: 600,
            cacheWriteTokens: 100,
          },
        },
      },
    ]);
    expect(result.sessions[0].usage).toEqual([
      {
        model: "GLM-5.2",
        inputTokens: 300,
        outputTokens: 50,
        cacheReadTokens: 600,
        cacheWriteTokens: 100,
      },
    ]);
  });

  it("returns a structured parse error for an empty or malformed source", async () => {
    const result = await parse(codexAdapter, [], true);
    expect(result.sessions).toEqual([]);
    expect(result.errors[0]).toMatchObject({
      provider: "codex",
      code: "parse_error",
    });
  });
});
