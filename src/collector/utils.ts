import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SessionStatus, StatusReason, TerminalStatus } from "@/lib/types";

export const homePath = (...parts: string[]) =>
  path.join(os.homedir(), ...parts);

export async function walkJsonl(root: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) return walk(fullPath);
        if (entry.isFile() && entry.name.endsWith(".jsonl"))
          result.push(fullPath);
      }),
    );
  }
  await walk(root);
  return result.sort();
}

export function parseLines(content: string): unknown[] {
  return content
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    });
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function codexDelegationInput(value: unknown): string | undefined {
  const raw = stringValue(value);
  const match = raw?.match(
    /<codex_delegation\b[^>]*>[\s\S]*?<input>([\s\S]*?)<\/input>[\s\S]*?<\/codex_delegation>/i,
  );
  return stringValue(match?.[1]);
}

export function safeTitle(value: unknown, fallback: string): string {
  const raw = stringValue(value);
  const text = raw
    ?.replace(/<recommended_plugins>[\s\S]*?<\/recommended_plugins>/gi, " ")
    .replace(
      /<in-app-browser-context[^>]*>[\s\S]*?<\/in-app-browser-context>/gi,
      " ",
    )
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, " ")
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi, " ")
    .replace(/<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>/gi, " ")
    .replace(/<command-message>[\s\S]*?<\/command-message>/gi, " ")
    .replace(/<command-name>[\s\S]*?<\/command-name>/gi, " ")
    .replace(/<scheduled-task[^>]*>[\s\S]*?<\/scheduled-task>/gi, " ")
    .replace(/^# AGENTS\.md instructions[^\n]*/gim, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return fallback;
  return text.length > 96 ? `${text.slice(0, 93)}…` : text;
}

export function repositoryFromCwd(cwd?: string): string | undefined {
  return cwd ? path.basename(cwd) : undefined;
}

export function staleStatus(
  updatedAt: string,
  terminal?: TerminalStatus,
): { status: SessionStatus; reason?: StatusReason } {
  if (terminal) return { status: terminal.status, reason: terminal.reason };
  return {
    status:
      Date.now() - new Date(updatedAt).getTime() < 10 * 60 * 1000
        ? "running"
        : "incomplete",
  };
}
