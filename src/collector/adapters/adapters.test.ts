import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProviderAdapter } from "@/lib/types";
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
beforeEach(() => {
  process.env.ZCODE_DB_PATH = ZCODE_DB_GUARD;
  __resetZcodeDbCache();
});
afterEach(() => {
  delete process.env.ZCODE_DB_PATH;
  __resetZcodeDbCache();
});

async function parse(
  adapter: ProviderAdapter,
  rows: unknown[],
  partial = false,
) {
  return adapter.parse(await fixture(rows, partial));
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
    expect(failed.sessions[0]?.status).toBe("needs_attention");
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
