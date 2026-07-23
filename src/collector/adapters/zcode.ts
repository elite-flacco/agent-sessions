import type { CapabilityUsage, ModelUsage, ProviderAdapter } from "@/lib/types";
import { __resetZcodeDbCache, getZcodeSessionMetadata } from "@/lib/zcode-db";
import {
  explicitSkillUsage,
  matchedSkillReads,
  mcpUsage,
} from "../capabilities";
import {
  homePath,
  record,
  repositoryFromCwd,
  safeTitle,
  stringValue,
  walkJsonl,
} from "../utils";
import {
  accumulateUsage,
  contentText,
  filenameId,
  numberedEvent,
  parseJsonl,
  sessionSummary,
  timestamp,
  tokenCount,
} from "./shared";

export { __resetZcodeDbCache };

export const zcodeAdapter: ProviderAdapter = {
  provider: "zcode",
  discover: async () => {
    const rollout = await walkJsonl(homePath(".zcode", "cli", "rollout"));
    const agents = await walkJsonl(homePath(".zcode", "cli", "agents"));
    return [...rollout, ...agents];
  },
  parse: async (filePath, context) => {
    const result = await parseJsonl(filePath, {
      provider: "zcode",
      fallbackTitle: "Zcode coding session",
      identify: (rows) =>
        stringValue(rows.find((row) => row.sessionId)?.sessionId) ??
        filenameId(filePath),
      cwd: (rows) => stringValue(rows.find((row) => row.cwd)?.cwd),
      branch: (rows) =>
        stringValue(rows.find((row) => row.gitBranch)?.gitBranch),
      title: (rows) => {
        for (const row of rows) {
          const request = record(row.request);
          const messages = Array.isArray(request?.messages)
            ? request.messages.map(record).filter(Boolean)
            : [];
          const user = messages.find((message) => message?.role === "user");
          const candidate =
            contentText(user?.content) ?? contentText(request?.content);
          if (
            candidate &&
            !candidate.startsWith("Generate a concise title") &&
            !candidate.startsWith("You are ZCode")
          )
            return candidate;
        }
        return undefined;
      },
      terminalStatus: (rows) => {
        for (const row of [...rows].reverse()) {
          if (row.status === "cancelled") return { status: "interrupted" };
          // Rollout rows carry no error text, so the reason is the generic
          // execution failure; the DB reconcile path derives richer reasons.
          if (row.status === "failed")
            return { status: "failed", reason: "execution_error" };
          if (
            row.status === "completed" ||
            Boolean(row.completedAt) ||
            row.type === "result" ||
            row.type === "turn_complete"
          )
            return { status: "completed" };
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
      capabilityUsage: (rows) => {
        const seenCallIds = new Set<string>();
        return rows.flatMap((row, rowIndex) => {
          const request = record(row.request);
          const messages = Array.isArray(request?.messages)
            ? request.messages.map(record).filter(Boolean)
            : [];
          const requestToolCalls = messages.flatMap((message) => {
            const toolCalls = Array.isArray(message?.toolCalls)
              ? message.toolCalls.map(record).filter(Boolean)
              : [];
            return toolCalls;
          });
          const response = record(row.response);
          const responseToolCalls = Array.isArray(response?.toolCalls)
            ? response.toolCalls.map(record).filter(Boolean)
            : [];
          return [...requestToolCalls, ...responseToolCalls].flatMap(
            (tool, blockIndex) => {
              if (!tool) return [];
              const callId = stringValue(tool.id) ?? stringValue(tool.callId);
              if (callId && seenCallIds.has(callId)) return [];
              if (callId) seenCallIds.add(callId);
              const externalId =
                callId ??
                stringValue(row.uuid) ??
                stringValue(row.id) ??
                `${rowIndex}-${blockIndex}`;
              const occurredAt = timestamp(row) ?? new Date(0).toISOString();
              return [
                explicitSkillUsage(
                  externalId,
                  tool.name === "Skill"
                    ? record(tool.arguments ?? tool.input)?.skill
                    : undefined,
                  occurredAt,
                ),
                mcpUsage({
                  externalId,
                  toolName: tool.name,
                  namespace: tool.namespace,
                  occurredAt,
                }),
                ...matchedSkillReads({
                  externalId,
                  toolName: tool.name,
                  input: tool.arguments ?? tool.input,
                  occurredAt,
                  lookup: context?.capabilities,
                }),
              ].filter(
                (entry): entry is CapabilityUsage => entry !== undefined,
              );
            },
          );
        });
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
    });

    // ZCode's session DB is authoritative for its display title and is also the
    // fallback for cwd because interactive model_io rows omit that field.
    const session = result.sessions[0];
    if (session?.externalId) {
      const metadata = getZcodeSessionMetadata(session.externalId);
      if (metadata?.title)
        session.title = safeTitle(metadata.title, session.title);
      if (metadata?.parentId) {
        session.parentExternalId = metadata.parentId;
        session.sessionKind = "subagent";
        session.agentDepth = 1;
      } else {
        session.sessionKind = "main";
        session.agentDepth = 0;
      }
      if (!session.cwd && metadata?.directory) {
        session.cwd = metadata.directory;
        session.repository = repositoryFromCwd(metadata.directory);
        session.summary = sessionSummary("zcode", metadata.directory);
      }
    }
    return result;
  },
};
