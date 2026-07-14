import fs from "node:fs/promises";
import type { AgentProvider } from "./types";
import { readZcodeSessionMessages, type ZcodeStoredMessage } from "./zcode-db";

export type TranscriptEntryKind = "user" | "assistant" | "tool" | "result";

export interface TranscriptEntry {
  id: string;
  kind: TranscriptEntryKind;
  title: string;
  content: string | null;
  input: string | null;
  output: string | null;
  occurredAt: string | null;
  isError: boolean;
}

export interface SessionTranscript {
  entries: TranscriptEntry[];
  sourceAvailable: boolean;
  truncated: boolean;
}

interface TranscriptSession {
  externalId?: string;
  provider: AgentProvider;
  sourcePath: string | null;
}

const MAX_ENTRIES = 500;
const MAX_PAYLOAD_CHARS = 40_000;
const SENSITIVE_KEY =
  /^(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|cookie|credential|private[_-]?key)$/i;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function redactString(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, "[redacted]")
    .replace(/\bgh(?:p|o|u|s|r)_[A-Za-z0-9_]{10,}\b/g, "[redacted]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{10,}\b/g, "[redacted]")
    .replace(/\bAKIA[A-Z0-9]{16}\b/g, "[redacted]");
}

export function redactPayload(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactPayload);
  const valueRecord = record(value);
  if (!valueRecord) return value;
  return Object.fromEntries(
    Object.entries(valueRecord).map(([key, child]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[redacted]" : redactPayload(child),
    ]),
  );
}

function parsePayload(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function formatPayload(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const redacted = redactPayload(parsePayload(value));
  const formatted =
    typeof redacted === "string" ? redacted : JSON.stringify(redacted, null, 2);
  if (!formatted) return null;
  return formatted.length > MAX_PAYLOAD_CHARS
    ? `${formatted.slice(0, MAX_PAYLOAD_CHARS)}\n… payload truncated …`
    : formatted;
}

function occurredAt(row: Record<string, unknown>): string | null {
  return (
    stringValue(row.timestamp) ??
    stringValue(row.startedAt) ??
    stringValue(row.completedAt) ??
    null
  );
}

function occurredAtMilliseconds(value: unknown): string | null {
  const milliseconds = numberValue(value);
  if (milliseconds === undefined) return null;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function textContent(value: unknown): string | null {
  if (typeof value === "string") return redactString(value);
  if (!Array.isArray(value)) {
    const valueRecord = record(value);
    return valueRecord
      ? textContent(valueRecord.text ?? valueRecord.content)
      : null;
  }
  const text = value
    .flatMap((item) => {
      const itemRecord = record(item);
      if (!itemRecord) return [];
      const type = stringValue(itemRecord.type);
      if (
        type &&
        type !== "text" &&
        type !== "input_text" &&
        type !== "output_text"
      )
        return [];
      const content = textContent(itemRecord.text ?? itemRecord.content);
      return content ? [content] : [];
    })
    .join("\n");
  return text || null;
}

function callId(block: Record<string, unknown>): string | undefined {
  return (
    stringValue(block.call_id) ??
    stringValue(block.tool_use_id) ??
    stringValue(block.toolCallId) ??
    stringValue(block.id)
  );
}

function addMessage(
  entries: TranscriptEntry[],
  seen: Set<string>,
  row: Record<string, unknown>,
  index: number,
  role: unknown,
  content: unknown,
): void {
  if (role !== "user" && role !== "assistant") return;
  const text = textContent(content);
  if (!text) return;
  const signature = `${role}:${text}`;
  if (seen.has(signature)) return;
  seen.add(signature);
  entries.push({
    id: `${index}-${role}`,
    kind: role,
    title: role === "user" ? "User" : "Assistant",
    content: text,
    input: null,
    output: null,
    occurredAt: occurredAt(row),
    isError: false,
  });
}

function addTool(
  entries: TranscriptEntry[],
  calls: Map<string, TranscriptEntry>,
  row: Record<string, unknown>,
  index: number,
  block: Record<string, unknown>,
): void {
  const id = callId(block) ?? `${index}-tool`;
  const entry: TranscriptEntry = {
    id: `${index}-tool-${id}`,
    kind: "tool",
    title:
      stringValue(block.name) ?? stringValue(block.toolName) ?? "Tool call",
    content: null,
    input: formatPayload(block.input ?? block.arguments ?? block.args),
    output: null,
    occurredAt: occurredAt(row),
    isError: false,
  };
  entries.push(entry);
  calls.set(id, entry);
}

function addToolResult(
  entries: TranscriptEntry[],
  calls: Map<string, TranscriptEntry>,
  row: Record<string, unknown>,
  index: number,
  block: Record<string, unknown>,
): void {
  const id = callId(block);
  const output = formatPayload(
    block.output ?? block.result ?? block.content ?? block.value,
  );
  const isError = block.is_error === true || block.isError === true;
  const call = id ? calls.get(id) : undefined;
  if (call) {
    call.output = output;
    call.isError = isError;
    return;
  }
  entries.push({
    id: `${index}-result-${id ?? "unknown"}`,
    kind: "result",
    title: isError ? "Tool error" : "Tool result",
    content: output,
    input: null,
    output: null,
    occurredAt: occurredAt(row),
    isError,
  });
}

function addBlocks(
  entries: TranscriptEntry[],
  calls: Map<string, TranscriptEntry>,
  row: Record<string, unknown>,
  index: number,
  content: unknown,
): void {
  if (!Array.isArray(content)) return;
  for (const value of content) {
    const block = record(value);
    if (!block) continue;
    const type = stringValue(block.type);
    if (type === "tool_use" || type === "toolCall" || type === "tool_call")
      addTool(entries, calls, row, index, block);
    if (
      type === "tool_result" ||
      type === "toolResult" ||
      type === "function_call_output"
    )
      addToolResult(entries, calls, row, index, block);
  }
}

function parseRows(
  rows: Record<string, unknown>[],
  provider: AgentProvider,
): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  const calls = new Map<string, TranscriptEntry>();
  const seenMessages = new Set<string>();

  rows.forEach((row, index) => {
    if (provider === "codex") {
      const payload = record(row.payload);
      if (row.type === "response_item" && payload) {
        if (payload.type === "message")
          addMessage(
            entries,
            seenMessages,
            row,
            index,
            payload.role,
            payload.content,
          );
        if (
          payload.type === "function_call" ||
          payload.type === "custom_tool_call"
        )
          addTool(entries, calls, row, index, payload);
        if (
          payload.type === "function_call_output" ||
          payload.type === "custom_tool_call_output"
        )
          addToolResult(entries, calls, row, index, payload);
      }
      return;
    }

    const message = record(row.message);
    if (message) {
      addMessage(
        entries,
        seenMessages,
        row,
        index,
        message.role,
        message.content,
      );
      addBlocks(entries, calls, row, index, message.content);
    }

    if (provider === "zcode" && row.type === "model_io") {
      const request = record(row.request);
      const response = record(row.response);
      const messages = Array.isArray(request?.messages)
        ? request.messages.map(record).filter(Boolean)
        : [];
      const lastUser = [...messages]
        .reverse()
        .find((candidate) => candidate?.role === "user");
      if (lastUser)
        addMessage(entries, seenMessages, row, index, "user", lastUser.content);
      else
        addMessage(entries, seenMessages, row, index, "user", request?.content);
      addMessage(
        entries,
        seenMessages,
        row,
        index,
        "assistant",
        response?.content ?? response?.text,
      );
      addBlocks(entries, calls, row, index, response?.content);
      const toolCalls = Array.isArray(response?.toolCalls)
        ? response.toolCalls.flatMap((value) => {
            const toolCall = record(value);
            return toolCall ? [toolCall] : [];
          })
        : [];
      for (const toolCall of toolCalls)
        addTool(entries, calls, row, index, toolCall);
    }
  });
  return entries;
}

function parseZcodeStoredMessages(
  messages: ZcodeStoredMessage[],
): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const message of messages) {
    const messageData = record(message.data);
    if (
      !messageData ||
      messageData.synthetic === true ||
      messageData.visibility === "model-only"
    )
      continue;
    const role = stringValue(messageData.role);
    if (role !== "user" && role !== "assistant") continue;
    const messageTime = record(messageData.time);
    const messageOccurredAt =
      occurredAtMilliseconds(messageTime?.created) ??
      occurredAtMilliseconds(message.timeCreated);

    for (const part of message.parts) {
      const partData = record(part.data);
      if (!partData || partData.synthetic === true) continue;
      const type = stringValue(partData.type);
      const partTime = record(partData.time);
      const partOccurredAt =
        occurredAtMilliseconds(partTime?.start) ??
        occurredAtMilliseconds(part.timeCreated) ??
        messageOccurredAt;

      if (type === "text") {
        const content = textContent(partData.text);
        if (!content) continue;
        entries.push({
          id: `zcode-${part.id}`,
          kind: role,
          title: role === "user" ? "User" : "Assistant",
          content,
          input: null,
          output: null,
          occurredAt: partOccurredAt,
          isError: false,
        });
        continue;
      }

      if (type === "tool") {
        const state = record(partData.state);
        const status = stringValue(state?.status);
        const isError = status === "error";
        entries.push({
          id: `zcode-${part.id}`,
          kind: "tool",
          title: stringValue(partData.tool) ?? "Tool call",
          content: null,
          input: formatPayload(state?.input),
          output: formatPayload(
            isError ? (state?.error ?? state?.output) : state?.output,
          ),
          occurredAt: partOccurredAt,
          isError,
        });
      }
    }
  }
  return entries;
}

export async function readSessionTranscript(
  session: TranscriptSession,
): Promise<SessionTranscript> {
  if (session.provider === "zcode" && session.externalId) {
    const messages = readZcodeSessionMessages(session.externalId);
    if (messages?.length) {
      const allEntries = parseZcodeStoredMessages(messages);
      return {
        entries: allEntries.slice(-MAX_ENTRIES),
        sourceAvailable: true,
        truncated: allEntries.length > MAX_ENTRIES,
      };
    }
  }
  if (!session.sourcePath)
    return { entries: [], sourceAvailable: false, truncated: false };
  try {
    const source = await fs.readFile(session.sourcePath, "utf8");
    const rows = source.split("\n").flatMap((line) => {
      if (!line.trim()) return [];
      try {
        const value = record(JSON.parse(line) as unknown);
        return value ? [value] : [];
      } catch {
        return [];
      }
    });
    const allEntries = parseRows(rows, session.provider);
    return {
      entries: allEntries.slice(-MAX_ENTRIES),
      sourceAvailable: true,
      truncated: allEntries.length > MAX_ENTRIES,
    };
  } catch {
    return { entries: [], sourceAvailable: false, truncated: false };
  }
}
