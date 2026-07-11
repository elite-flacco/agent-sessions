import type { ProviderAdapter } from "@/lib/types";
import { homePath, record, safeTitle, stringValue, walkJsonl } from "../utils";
import { contentText, filenameId, numberedEvent, parseJsonl } from "./shared";

export const codexAdapter: ProviderAdapter = {
  provider: "codex",
  discover: () => walkJsonl(homePath(".codex", "sessions")),
  parse: (filePath) =>
    parseJsonl(filePath, {
      provider: "codex",
      fallbackTitle: "Codex coding session",
      identify: (rows) => {
        const meta = rows.find((row) => row.type === "session_meta");
        return stringValue(record(meta?.payload)?.id) ?? filenameId(filePath);
      },
      cwd: (rows) => {
        const meta = rows.find((row) => row.type === "session_meta");
        return stringValue(record(meta?.payload)?.cwd);
      },
      branch: (rows) => {
        const meta = rows.find((row) => row.type === "session_meta");
        return stringValue(record(record(meta?.payload)?.git)?.branch);
      },
      title: (rows) => {
        for (const row of rows) {
          const payload = record(row.payload);
          if (row.type === "response_item" && payload?.role === "user") {
            const candidate = contentText(payload.content);
            if (safeTitle(candidate, "")) return candidate;
          }
        }
      },
      completed: (rows) => {
        for (const row of [...rows].reverse()) {
          const type = record(row.payload)?.type;
          if (type === "task_complete" || type === "turn_aborted") return true;
          if (type === "task_started") return false;
        }
        return false;
      },
      model: (rows) => {
        const meta = rows.find((row) => row.type === "session_meta");
        return stringValue(record(meta?.payload)?.model_provider);
      },
      tokens: (rows) => {
        let inputTokens = 0;
        let outputTokens = 0;
        let cachedTokens = 0;
        for (const row of rows) {
          const payload = record(row.payload);
          if (payload?.type !== "token_count") continue;
          const info = record(payload.info);
          const usage = record(info?.total_token_usage);
          inputTokens = Number(usage?.input_tokens ?? inputTokens);
          outputTokens = Number(usage?.output_tokens ?? outputTokens);
          cachedTokens = Number(usage?.cached_input_tokens ?? cachedTokens);
        }
        return {
          inputTokens: inputTokens || undefined,
          outputTokens: outputTokens || undefined,
          cachedTokens: cachedTokens || undefined,
        };
      },
      events: (rows) =>
        rows.flatMap((row, index) => {
          const payload = record(row.payload);
          const type = stringValue(payload?.type);
          if (type === "task_started")
            return [numberedEvent(row, index, "started", "Task started")];
          if (type === "task_complete")
            return [numberedEvent(row, index, "completed", "Task completed")];
          if (type === "turn_aborted")
            return [numberedEvent(row, index, "warning", "Turn interrupted")];
          if (row.type === "response_item" && type === "function_call") {
            return [
              numberedEvent(
                row,
                index,
                "tool",
                `Used ${stringValue(payload?.name) ?? "a tool"}`,
              ),
            ];
          }
          return [];
        }),
    }),
};
