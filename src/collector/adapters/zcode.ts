import type { ModelUsage, ProviderAdapter } from "@/lib/types";
import { __resetZcodeDbCache, getZcodeSessionMetadata } from "@/lib/zcode-db";
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
  parse: async (filePath) => {
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
