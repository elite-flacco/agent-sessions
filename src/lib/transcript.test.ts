import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { readSessionTranscript, redactPayload } from "./transcript";
import { __resetZcodeDbCache } from "./zcode-db";

const temporaryFiles: string[] = [];

async function fixture(rows: unknown[]): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarium-log-"));
  const filePath = path.join(directory, "session.jsonl");
  temporaryFiles.push(directory);
  await fs.writeFile(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n"),
  );
  return filePath;
}

afterEach(async () => {
  delete process.env.ZCODE_DB_PATH;
  __resetZcodeDbCache();
  await Promise.all(
    temporaryFiles
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("session transcript", () => {
  it("renders Codex messages and pairs redacted tool arguments with output", async () => {
    const sourcePath = await fixture([
      {
        type: "response_item",
        timestamp: "2026-07-13T10:00:00Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Inspect the build" }],
        },
      },
      {
        type: "response_item",
        timestamp: "2026-07-13T10:00:01Z",
        payload: {
          type: "custom_tool_call",
          call_id: "call-1",
          name: "exec_command",
          input: JSON.stringify({ cmd: "npm test", api_key: "private" }),
        },
      },
      {
        type: "response_item",
        timestamp: "2026-07-13T10:00:02Z",
        payload: {
          type: "custom_tool_call_output",
          call_id: "call-1",
          output: "Bearer abcdefghijklmnop",
        },
      },
      {
        type: "response_item",
        timestamp: "2026-07-13T10:00:03Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "The build passed." }],
        },
      },
    ]);

    const transcript = await readSessionTranscript({
      provider: "codex",
      sourcePath,
    });

    expect(transcript.entries.map((entry) => entry.kind)).toEqual([
      "user",
      "tool",
      "assistant",
    ]);
    expect(transcript.entries[1]).toMatchObject({
      title: "exec_command",
      input: expect.stringContaining('"api_key": "[redacted]"'),
      output: "Bearer [redacted]",
    });
  });

  it("does not expose common credential fields or token shapes", () => {
    expect(
      JSON.stringify(
        redactPayload({
          password: "hunter2",
          nested: { authorization: "Bearer private" },
          command: "curl -H 'Authorization: Bearer private-token'",
          key: "sk-1234567890abcdef",
        }),
      ),
    ).not.toContain("hunter2");
  });

  it("reads Zcode messages and tools from its database without exposing reasoning", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "agentarium-zcode-"),
    );
    temporaryFiles.push(directory);
    const dbPath = path.join(directory, "db.sqlite");
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        data TEXT NOT NULL
      );
    `);
    const insertMessage = db.prepare(
      "INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
    );
    const insertPart = db.prepare(
      "INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)",
    );
    insertMessage.run(
      "message-user",
      "zcode-1",
      1_750_000_000_000,
      JSON.stringify({ role: "user", time: { created: 1_750_000_000_000 } }),
    );
    insertPart.run(
      "part-user",
      "message-user",
      "zcode-1",
      1_750_000_000_001,
      JSON.stringify({ type: "text", text: "Inspect the collector" }),
    );
    insertMessage.run(
      "message-assistant",
      "zcode-1",
      1_750_000_000_002,
      JSON.stringify({
        role: "assistant",
        time: { created: 1_750_000_000_002 },
      }),
    );
    insertPart.run(
      "part-reasoning",
      "message-assistant",
      "zcode-1",
      1_750_000_000_003,
      JSON.stringify({ type: "reasoning", text: "PRIVATE_REASONING" }),
    );
    insertPart.run(
      "part-tool",
      "message-assistant",
      "zcode-1",
      1_750_000_000_004,
      JSON.stringify({
        type: "tool",
        tool: "Bash",
        state: {
          status: "completed",
          input: { command: "npm test", api_key: "private" },
          output: "Bearer private-token",
          time: { start: 1_750_000_000_004 },
        },
      }),
    );
    insertPart.run(
      "part-assistant",
      "message-assistant",
      "zcode-1",
      1_750_000_000_005,
      JSON.stringify({ type: "text", text: "The collector is healthy." }),
    );
    db.close();
    process.env.ZCODE_DB_PATH = dbPath;
    __resetZcodeDbCache();

    const transcript = await readSessionTranscript({
      externalId: "zcode-1",
      provider: "zcode",
      sourcePath: null,
    });

    expect(transcript).toMatchObject({
      sourceAvailable: true,
      truncated: false,
    });
    expect(transcript.entries.map((entry) => entry.kind)).toEqual([
      "user",
      "tool",
      "assistant",
    ]);
    expect(transcript.entries[1]).toMatchObject({
      title: "Bash",
      input: expect.stringContaining('"api_key": "[redacted]"'),
      output: "Bearer [redacted]",
    });
    expect(JSON.stringify(transcript)).not.toContain("PRIVATE_REASONING");
  });

  it("falls back to current Zcode model I/O fields when its database is unavailable", async () => {
    process.env.ZCODE_DB_PATH = "/dev/null/missing-zcode-db";
    __resetZcodeDbCache();
    const sourcePath = await fixture([
      {
        type: "model_io",
        startedAt: "2026-07-13T10:00:00Z",
        request: { messages: [{ role: "user", content: "Run the tests" }] },
        response: {
          text: "The tests passed.",
          toolCalls: [
            { id: "tool-1", name: "Bash", input: { command: "npm test" } },
          ],
        },
      },
    ]);

    const transcript = await readSessionTranscript({
      externalId: "zcode-fallback",
      provider: "zcode",
      sourcePath,
    });

    expect(transcript.entries.map((entry) => entry.kind)).toEqual([
      "user",
      "assistant",
      "tool",
    ]);
    expect(transcript.entries[1].content).toBe("The tests passed.");
    expect(transcript.entries[2].title).toBe("Bash");
  });
});
