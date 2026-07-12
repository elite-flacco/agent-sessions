import type { ModelUsage, ProviderAdapter } from "@/lib/types";
import { homePath, record, stringValue, walkJsonl } from "../utils";
import {
  accumulateUsage,
  contentText,
  filenameId,
  numberedEvent,
  parseJsonl,
  tokenCount,
} from "./shared";

export const zcodeAdapter: ProviderAdapter = {
  provider: "zcode",
  discover: async () => {
    const rollout = await walkJsonl(homePath(".zcode", "cli", "rollout"));
    const agents = await walkJsonl(homePath(".zcode", "cli", "agents"));
    return [...rollout, ...agents];
  },
  parse: (filePath) =>
    parseJsonl(filePath, {
      provider: "zcode",
      fallbackTitle: "Zcode coding session",
      identify: (rows) =>
        stringValue(rows.find((row) => row.sessionId)?.sessionId) ??
        filenameId(filePath),
      cwd: (rows) => stringValue(rows.find((row) => row.cwd)?.cwd),
      branch: (rows) =>
        stringValue(rows.find((row) => row.gitBranch)?.gitBranch),
      title: (rows) => {
        const request = rows.map((row) => record(row.request)).find(Boolean);
        const candidate =
          contentText(request?.messages) ?? contentText(request?.content);
        if (
          candidate?.startsWith("Generate a concise title") ||
          candidate?.startsWith("You are ZCode")
        )
          return undefined;
        return candidate;
      },
      terminalStatus: (rows) => {
        for (const row of [...rows].reverse()) {
          if (row.status === "cancelled") return "interrupted";
          if (row.status === "failed") return "needs_attention";
          if (
            row.status === "completed" ||
            Boolean(row.completedAt) ||
            row.type === "result" ||
            row.type === "turn_complete"
          )
            return "completed";
        }
        return undefined;
      },
      // model_io rows carry response.usage (camelCase, one row per request);
      // its inputTokens includes cache traffic, so uncached input is the
      // remainder after subtracting reads and writes.
      usage: (rows) => {
        const byModel = new Map<string, ModelUsage>();
        for (const row of rows) {
          if (row.type !== "model_io") continue;
          const usage = record(record(row.response)?.usage);
          const model =
            stringValue(row.model) ?? stringValue(record(row.model)?.modelId);
          if (!usage || !model) continue;
          const cacheRead = tokenCount(usage.cacheReadTokens);
          const cacheWrite = tokenCount(usage.cacheWriteTokens);
          accumulateUsage(byModel, model, {
            inputTokens: Math.max(
              0,
              tokenCount(usage.inputTokens) - cacheRead - cacheWrite,
            ),
            outputTokens: tokenCount(usage.outputTokens),
            cacheReadTokens: cacheRead,
            cacheWriteTokens: cacheWrite,
          });
        }
        return [...byModel.values()];
      },
      events: (rows) =>
        rows.flatMap((row, index) => {
          if (row.type === "model_io")
            return [
              numberedEvent(
                row,
                index,
                "info",
                `Model request${stringValue(row.model) ? ` · ${stringValue(row.model)}` : ""}`,
              ),
            ];
          const message = record(row.message);
          const blocks = Array.isArray(message?.content) ? message.content : [];
          const tool = blocks
            .map(record)
            .find(
              (block) =>
                block?.type === "tool_use" || block?.type === "toolCall",
            );
          return tool
            ? [
                numberedEvent(
                  row,
                  index,
                  "tool",
                  `Used ${stringValue(tool.name) ?? "a tool"}`,
                ),
              ]
            : [];
        }),
    }),
};
