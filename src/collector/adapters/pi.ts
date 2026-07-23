import type { CapabilityUsage, ModelUsage, ProviderAdapter } from "@/lib/types";
import {
  capabilityTimestamp,
  matchedSkillReads,
  mcpUsage,
} from "../capabilities";
import { homePath, record, stringValue, walkJsonl } from "../utils";
import {
  accumulateUsage,
  contentText,
  filenameId,
  numberedEvent,
  parseJsonl,
  timestamp,
  tokenCount,
} from "./shared";

export const piAdapter: ProviderAdapter = {
  provider: "pi",
  discover: () => walkJsonl(homePath(".pi", "agent", "sessions")),
  parse: (filePath, context) =>
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
      terminalStatus: (rows) => {
        for (const row of [...rows].reverse()) {
          if (row.type === "session_end") return { status: "completed" };
          if (row.type !== "message") continue;
          const message = record(row.message);
          if (message?.role === "user") return undefined;
          if (message?.role === "assistant" && message.stopReason === "stop")
            return { status: "completed" };
        }
        return undefined;
      },
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
      capabilityUsage: (rows) =>
        rows.flatMap((row, rowIndex) => {
          const message = record(row.message);
          const blocks = Array.isArray(message?.content)
            ? message.content.map(record).filter(Boolean)
            : [];
          const occurredAt = capabilityTimestamp(timestamp(row));
          if (!occurredAt) return [];
          return blocks.flatMap((tool, blockIndex) => {
            if (tool?.type !== "toolCall" && tool?.type !== "tool_use")
              return [];
            const externalId =
              stringValue(tool.id) ??
              stringValue(row.uuid) ??
              stringValue(row.id) ??
              `${rowIndex}-${blockIndex}`;
            return [
              mcpUsage({
                externalId,
                toolName: tool.name,
                namespace: tool.namespace,
                occurredAt,
                lookup: context?.capabilities,
              }),
              ...matchedSkillReads({
                externalId,
                toolName: tool.name,
                input: tool.arguments ?? tool.input,
                occurredAt,
                lookup: context?.capabilities,
              }),
            ].filter((entry): entry is CapabilityUsage => entry !== undefined);
          });
        }),
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
