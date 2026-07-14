import type { ModelUsage, ProviderAdapter } from "@/lib/types";
import { homePath, record, safeTitle, stringValue, walkJsonl } from "../utils";
import {
  accumulateUsage,
  contentText,
  filenameId,
  numberedEvent,
  parseJsonl,
  tokenCount,
} from "./shared";

export const claudeAdapter: ProviderAdapter = {
  provider: "claude",
  discover: () => walkJsonl(homePath(".claude", "projects")),
  parse: (filePath) =>
    parseJsonl(filePath, {
      provider: "claude",
      fallbackTitle: "Claude Code session",
      identify: (rows) => {
        const child = rows.find(
          (row) => row.isSidechain === true && stringValue(row.agentId),
        );
        return (
          stringValue(child?.agentId) ??
          stringValue(rows.find((row) => row.sessionId)?.sessionId) ??
          filenameId(filePath)
        );
      },
      cwd: (rows) => stringValue(rows.find((row) => row.cwd)?.cwd),
      branch: (rows) =>
        stringValue(rows.find((row) => row.gitBranch)?.gitBranch),
      hierarchy: (rows) => {
        const child = rows.find(
          (row) => row.isSidechain === true && stringValue(row.agentId),
        );
        return child
          ? {
              parentExternalId: stringValue(child.sessionId),
              sessionKind: "subagent",
              agentLabel: stringValue(child.agentId),
              agentDepth: 1,
            }
          : { sessionKind: "main", agentDepth: 0 };
      },
      title: (rows) => {
        for (const row of rows) {
          if (row.type !== "user" || record(row.message)?.role !== "user")
            continue;
          const candidate = contentText(record(row.message)?.content);
          if (safeTitle(candidate, "")) return candidate;
        }
      },
      terminalStatus: (rows) => {
        for (const row of [...rows].reverse()) {
          if (row.type === "result") return "completed";
          if (row.type === "user") return undefined;
          if (
            row.type === "assistant" &&
            record(row.message)?.stop_reason === "end_turn"
          )
            return "completed";
        }
        return undefined;
      },
      // Streaming repeats one API call's usage across rows sharing a
      // message id, so each id counts once. input_tokens is already
      // cache-exclusive; cache writes and reads are billed separately.
      usage: (rows) => {
        const seenMessageIds = new Set<string>();
        const byModel = new Map<string, ModelUsage>();
        for (const row of rows) {
          const message = record(row.message);
          const usage = record(message?.usage);
          const model = stringValue(message?.model);
          if (!usage || !model || model === "<synthetic>") continue;
          const messageId = stringValue(message?.id);
          if (messageId) {
            if (seenMessageIds.has(messageId)) continue;
            seenMessageIds.add(messageId);
          }
          accumulateUsage(byModel, model, {
            inputTokens: tokenCount(usage.input_tokens),
            outputTokens: tokenCount(usage.output_tokens),
            cacheReadTokens: tokenCount(usage.cache_read_input_tokens),
            cacheWriteTokens: tokenCount(usage.cache_creation_input_tokens),
          });
        }
        return [...byModel.values()];
      },
      events: (rows) =>
        rows.flatMap((row, index) => {
          if (row.type === "result")
            return [
              numberedEvent(row, index, "completed", "Session completed"),
            ];
          const message = record(row.message);
          const blocks = Array.isArray(message?.content) ? message.content : [];
          const tool = blocks
            .map(record)
            .find((block) => block?.type === "tool_use");
          if (tool)
            return [
              numberedEvent(
                row,
                index,
                "tool",
                `Used ${stringValue(tool.name) ?? "a tool"}`,
              ),
            ];
          return [];
        }),
    }),
};
