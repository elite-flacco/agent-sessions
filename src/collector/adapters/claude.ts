import type { CapabilityUsage, ModelUsage, ProviderAdapter } from "@/lib/types";
import {
  capabilityTimestamp,
  explicitSkillUsage,
  mcpUsage,
} from "../capabilities";
import { homePath, record, safeTitle, stringValue, walkJsonl } from "../utils";
import {
  accumulateUsage,
  contentText,
  filenameId,
  numberedEvent,
  parseJsonl,
  timestamp,
  tokenCount,
} from "./shared";

function slashSkillCommand(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const commandName = value.match(
    /<command-name>\s*\/([^<]+)<\/command-name>/,
  )?.[1];
  const commandMessage = value.match(
    /<command-message>\s*\/?([^<]+)<\/command-message>/,
  )?.[1];
  if (!commandName || !commandMessage) return undefined;
  const name = commandName.trim();
  return name.toLocaleLowerCase() === commandMessage.trim().toLocaleLowerCase()
    ? name
    : undefined;
}

export const claudeAdapter: ProviderAdapter = {
  provider: "claude",
  discover: () => walkJsonl(homePath(".claude", "projects")),
  parse: (filePath, context) =>
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
        for (const row of [...rows].reverse()) {
          if (row.type === "custom-title") {
            const title = stringValue(row.customTitle);
            if (title) return title;
          }
        }
        for (const row of [...rows].reverse()) {
          if (row.type === "ai-title") {
            const title = stringValue(row.aiTitle);
            if (title) return title;
          }
        }
        for (const row of rows) {
          if (row.type !== "user" || record(row.message)?.role !== "user")
            continue;
          const candidate = contentText(record(row.message)?.content);
          if (safeTitle(candidate, "")) return candidate;
        }
      },
      terminalStatus: (rows) => {
        for (const row of [...rows].reverse()) {
          if (row.type === "result") return { status: "completed" };
          if (
            row.type === "assistant" &&
            /usage[_\s-]?limit|rate[_\s-]?limit/i.test(
              stringValue(row.error) ?? "",
            )
          )
            return { status: "failed", reason: "usage_limit" };
          if (row.type === "user") return undefined;
          if (
            row.type === "assistant" &&
            record(row.message)?.stop_reason === "end_turn"
          )
            return { status: "completed" };
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
      capabilityUsage: (rows) =>
        rows.flatMap((row, rowIndex) => {
          const message = record(row.message);
          const blocks = Array.isArray(message?.content)
            ? message.content.map(record).filter(Boolean)
            : [];
          const occurredAt = capabilityTimestamp(timestamp(row));
          if (!occurredAt) return [];
          const rowExternalId =
            stringValue(row.uuid) ?? stringValue(row.id) ?? `${rowIndex}-0`;
          return [
            explicitSkillUsage(
              rowExternalId,
              slashSkillCommand(message?.content),
              occurredAt,
            ),
            ...blocks.flatMap((tool, blockIndex) => {
              if (tool?.type !== "tool_use") return [];
              const externalId =
                stringValue(tool.id) ??
                stringValue(row.uuid) ??
                stringValue(row.id) ??
                `${rowIndex}-${blockIndex}`;
              return [
                explicitSkillUsage(
                  externalId,
                  tool.name === "Skill" ? record(tool.input)?.skill : undefined,
                  occurredAt,
                ),
                mcpUsage({
                  externalId,
                  toolName: tool.name,
                  occurredAt,
                  lookup: context?.capabilities,
                }),
              ];
            }),
          ].filter((entry): entry is CapabilityUsage => entry !== undefined);
        }),
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
