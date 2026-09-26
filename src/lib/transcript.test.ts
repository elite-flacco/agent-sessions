import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, test } from "vitest";
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

  it("reads Zcode messages, reasoning, and tools from its database with redaction", async () => {
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
      JSON.stringify({
        type: "reasoning",
        text: "PRIVATE_REASONING sk-1234567890abcdef",
      }),
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
          time: { start: 1_750_000_000_004, end: 1_750_000_002_504 },
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
      "reasoning",
      "tool",
      "assistant",
    ]);
    expect(transcript.entries[1]).toMatchObject({
      kind: "reasoning",
      title: "Thinking",
      content: "PRIVATE_REASONING [redacted]",
    });
    expect(transcript.entries[2]).toMatchObject({
      title: "Bash",
      input: expect.stringContaining('"api_key": "[redacted]"'),
      output: "Bearer [redacted]",
      // A tool part is timed by its own run window, not the enclosing message.
      occurredAt: new Date(1_750_000_000_004).toISOString(),
      completedAt: new Date(1_750_000_002_504).toISOString(),
    });
  });

  it("stamps a paired tool result onto its call so the duration is derivable", async () => {
    const sourcePath = await fixture([
      {
        type: "response_item",
        timestamp: "2026-07-13T10:00:00Z",
        payload: {
          type: "function_call",
          call_id: "call-1",
          name: "Bash",
          arguments: { command: "npm test" },
        },
      },
      {
        type: "response_item",
        timestamp: "2026-07-13T10:00:03Z",
        payload: {
          type: "function_call_output",
          call_id: "call-1",
          output: "ok",
        },
      },
    ]);

    const transcript = await readSessionTranscript({
      externalId: "codex-1",
      provider: "codex",
      sourcePath,
    });

    expect(transcript.entries).toHaveLength(1);
    expect(transcript.entries[0]).toMatchObject({
      kind: "tool",
      title: "Bash",
      output: "ok",
      occurredAt: "2026-07-13T10:00:00Z",
      completedAt: "2026-07-13T10:00:03Z",
    });
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

  it("keeps repeated per-row messages that are distinct events", async () => {
    const sourcePath = await fixture([
      {
        timestamp: "2026-07-13T10:00:00Z",
        message: { role: "user", content: "Retry" },
      },
      {
        timestamp: "2026-07-13T10:00:01Z",
        message: { role: "assistant", content: "API Error: 529 Overloaded." },
      },
      {
        timestamp: "2026-07-13T10:00:02Z",
        message: { role: "assistant", content: "API Error: 529 Overloaded." },
      },
    ]);

    const transcript = await readSessionTranscript({
      externalId: "claude-retries",
      provider: "claude",
      sourcePath,
    });

    expect(
      transcript.entries.filter((entry) => entry.kind === "assistant"),
    ).toHaveLength(2);
  });

  it("collapses Zcode model I/O request history replayed across rows", async () => {
    process.env.ZCODE_DB_PATH = "/dev/null/missing-zcode-db";
    __resetZcodeDbCache();
    const sourcePath = await fixture([
      {
        type: "model_io",
        startedAt: "2026-07-13T10:00:00Z",
        request: { messages: [{ role: "user", content: "Run the tests" }] },
        response: { text: "Running them now." },
      },
      {
        type: "model_io",
        startedAt: "2026-07-13T10:00:05Z",
        request: { messages: [{ role: "user", content: "Run the tests" }] },
        response: { text: "The tests passed." },
      },
    ]);

    const transcript = await readSessionTranscript({
      externalId: "zcode-replay",
      provider: "zcode",
      sourcePath,
    });

    expect(transcript.entries.map((entry) => entry.kind)).toEqual([
      "user",
      "assistant",
      "assistant",
    ]);
  });
});

const dirs: string[] = [];

async function tmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "transcript-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

async function writeSource(rows: unknown[]): Promise<string> {
  const dir = await tmpDir();
  const file = path.join(dir, "session.jsonl");
  await fs.writeFile(
    file,
    rows.map((row) => JSON.stringify(row)).join("\n"),
    "utf8",
  );
  return file;
}

describe("readSessionTranscript reasoning extraction", () => {
  test("claude thinking blocks become redacted Thinking entries", async () => {
    const source = await writeSource([
      {
        timestamp: "2026-09-23T10:42:00.000Z",
        message: { role: "user", content: "Add a logout button" },
      },
      {
        timestamp: "2026-09-23T10:42:20.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking:
                "Check the settings page. Key sk-abcdef1234567890 stays secret.",
            },
            { type: "redacted_thinking", data: "opaque" },
            {
              type: "tool_use",
              id: "t1",
              name: "Read",
              input: { file_path: "src/app/page.tsx" },
            },
          ],
        },
      },
    ]);
    const transcript = await readSessionTranscript({
      externalId: "s",
      provider: "claude",
      sourcePath: source,
    });
    const reasoning = transcript.entries.filter(
      (entry) => entry.kind === "reasoning",
    );
    expect(reasoning).toHaveLength(1);
    expect(reasoning[0]).toMatchObject({
      kind: "reasoning",
      title: "Thinking",
      content: "Check the settings page. Key [redacted] stays secret.",
      occurredAt: "2026-09-23T10:42:20.000Z",
    });
    expect(transcript.entries.some((entry) => entry.kind === "tool")).toBe(
      true,
    );
  });

  test("zcode model_io reasoning blocks become Thinking entries", async () => {
    const source = await writeSource([
      {
        type: "model_io",
        timestamp: "2026-09-23T10:42:05.000Z",
        request: { messages: [{ role: "user", content: "Go" }] },
        response: {
          content: [
            { type: "reasoning", text: "Look at the repo first." },
            { type: "text", text: "On it." },
          ],
        },
      },
    ]);
    const transcript = await readSessionTranscript({
      externalId: "s",
      provider: "zcode",
      sourcePath: source,
    });
    expect(
      transcript.entries.some(
        (entry) =>
          entry.kind === "reasoning" &&
          entry.content === "Look at the repo first.",
      ),
    ).toBe(true);
  });

  test("codex reasoning items are included only when they carry text", async () => {
    const source = await writeSource([
      {
        type: "response_item",
        timestamp: "2026-09-23T10:42:05.000Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Go" }],
        },
      },
      {
        type: "response_item",
        timestamp: "2026-09-23T10:42:06.000Z",
        payload: {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "Planning." }],
        },
      },
      {
        type: "response_item",
        timestamp: "2026-09-23T10:42:07.000Z",
        payload: { type: "reasoning", summary: [] },
      },
    ]);
    const transcript = await readSessionTranscript({
      externalId: "s",
      provider: "codex",
      sourcePath: source,
    });
    const reasoning = transcript.entries.filter(
      (entry) => entry.kind === "reasoning",
    );
    expect(reasoning).toHaveLength(1);
    expect(reasoning[0].content).toBe("Planning.");
  });

  test("zcode stored reasoning parts become Thinking entries", async () => {
    const dir = await tmpDir();
    const dbPath = path.join(dir, "db.sqlite");
    process.env.ZCODE_DB_PATH = dbPath;
    const db = new Database(dbPath);
    db.exec(
      "CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT)",
    );
    db.exec(
      "CREATE TABLE part (id TEXT PRIMARY KEY, session_id TEXT, message_id TEXT, time_created INTEGER, data TEXT)",
    );
    db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run(
      "m1",
      "sess-1",
      1783000000000,
      JSON.stringify({ role: "assistant" }),
    );
    db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)").run(
      "p1",
      "sess-1",
      "m1",
      1783000000100,
      JSON.stringify({ type: "reasoning", text: "Let me look at the repo." }),
    );
    db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)").run(
      "p2",
      "sess-1",
      "m1",
      1783000000200,
      JSON.stringify({ type: "text", text: "On it." }),
    );
    db.close();
    try {
      const transcript = await readSessionTranscript({
        externalId: "sess-1",
        provider: "zcode",
        sourcePath: null,
      });
      expect(transcript.entries[0]).toMatchObject({
        kind: "reasoning",
        title: "Thinking",
        content: "Let me look at the repo.",
      });
      expect(transcript.entries[1]?.kind).toBe("assistant");
    } finally {
      delete process.env.ZCODE_DB_PATH;
    }
  });
});
