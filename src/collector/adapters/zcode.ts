import type { ProviderAdapter } from "@/lib/types";
import { homePath, record, stringValue, walkJsonl } from "../utils";
import { contentText, filenameId, numberedEvent, parseJsonl } from "./shared";

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
      completed: (rows) =>
        rows.some((row) => Boolean(row.completedAt) || row.type === "result"),
      model: (rows) => stringValue(rows.find((row) => row.model)?.model),
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
