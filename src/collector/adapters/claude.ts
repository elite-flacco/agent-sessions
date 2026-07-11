import type { ProviderAdapter } from "@/lib/types";
import { homePath, record, safeTitle, stringValue, walkJsonl } from "../utils";
import { contentText, filenameId, numberedEvent, parseJsonl } from "./shared";

export const claudeAdapter: ProviderAdapter = {
  provider: "claude",
  discover: () => walkJsonl(homePath(".claude", "projects")),
  parse: (filePath) =>
    parseJsonl(filePath, {
      provider: "claude",
      fallbackTitle: "Claude Code session",
      identify: (rows) =>
        stringValue(rows.find((row) => row.sessionId)?.sessionId) ??
        filenameId(filePath),
      cwd: (rows) => stringValue(rows.find((row) => row.cwd)?.cwd),
      branch: (rows) =>
        stringValue(rows.find((row) => row.gitBranch)?.gitBranch),
      title: (rows) => {
        for (const row of rows) {
          if (row.type !== "user" || record(row.message)?.role !== "user")
            continue;
          const candidate = contentText(record(row.message)?.content);
          if (safeTitle(candidate, "")) return candidate;
        }
      },
      completed: (rows) => rows.some((row) => row.type === "result"),
      model: (rows) =>
        stringValue(
          record(rows.find((row) => record(row.message)?.model)?.message)
            ?.model,
        ),
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
