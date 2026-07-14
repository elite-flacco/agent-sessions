import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readSessionTranscript, redactPayload } from "./transcript";

const temporaryFiles: string[] = [];

async function fixture(rows: unknown[]): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "relay-log-"));
  const filePath = path.join(directory, "session.jsonl");
  temporaryFiles.push(directory);
  await fs.writeFile(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n"),
  );
  return filePath;
}

afterEach(async () => {
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
});
