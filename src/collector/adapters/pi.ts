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

export const piAdapter: ProviderAdapter = {
  provider: "pi",
  discover: () => walkJsonl(homePath(".pi", "agent", "sessions")),
  parse: (filePath) =>
    parseJsonl(filePath, {
      provider: "pi",
      fallbackTitle: "Pi coding session",
      identify: (rows) =>
        stringValue(rows.find((row) => row.type === "session")?.id) ??
        filenameId(filePath),
      cwd: (rows) =>
        stringValue(rows.find((row) => row.type === "session")?.cwd),
      branch: () => undefined,
      title: (rows) => {
        const message = rows.find(
          (row) =>
            row.type === "message" && record(row.message)?.role === "user",
        );
        return contentText(record(message?.message)?.content);
      },
      terminalStatus: (rows) =>
        rows.some((row) => row.type === "session_end")
          ? "completed"
          : undefined,
      // Pi records normalized usage and the actual billed cost on each
      // assistant message; cost.total becomes the reported (not estimated)
      // session cost.
      usage: (rows) => {
        const byModel = new Map<string, ModelUsage>();
        for (const row of rows) {
          const message = record(row.message);
          const usage = record(message?.usage);
          const model = stringValue(message?.model);
          if (!usage || !model || message?.role !== "assistant") continue;
          const total = record(usage.cost)?.total;
          accumulateUsage(
            byModel,
            model,
            {
              inputTokens: tokenCount(usage.input),
              outputTokens: tokenCount(usage.output),
              cacheReadTokens: tokenCount(usage.cacheRead),
              cacheWriteTokens: tokenCount(usage.cacheWrite),
            },
            typeof total === "number" && Number.isFinite(total)
              ? total
              : undefined,
          );
        }
        return [...byModel.values()];
      },
      events: (rows) =>
        rows.flatMap((row, index) => {
          if (row.type === "session")
            return [numberedEvent(row, index, "started", "Session started")];
          if (row.type === "session_end")
            return [
              numberedEvent(row, index, "completed", "Session completed"),
            ];
          const message = record(row.message);
          const blocks = Array.isArray(message?.content) ? message.content : [];
          const tool = blocks
            .map(record)
            .find(
              (block) =>
                block?.type === "toolCall" || block?.type === "tool_use",
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
