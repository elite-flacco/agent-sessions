import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProviderAdapter } from "@/lib/types";
import { claudeAdapter } from "./claude";
import { codexAdapter } from "./codex";
import { piAdapter } from "./pi";
import { zcodeAdapter } from "./zcode";

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
      { type: "session_end", id: "end", timestamp: "2026-07-11T10:05:00Z" },
    ]);
    expect(result.sessions[0]).toMatchObject({
      externalId: "pi-1",
      title: "Inspect local sessions",
      status: "completed",
    });
    expect(result.sessions[0].usage?.model).toBe("gpt-5");
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

  it("returns a structured parse error for an empty or malformed source", async () => {
    const result = await parse(codexAdapter, [], true);
    expect(result.sessions).toEqual([]);
    expect(result.errors[0]).toMatchObject({
      provider: "codex",
      code: "parse_error",
    });
  });
});
