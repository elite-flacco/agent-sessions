import type { ProviderAdapter } from "@/lib/types";
import { homePath, record, safeTitle, stringValue, walkJsonl } from "../utils";
import {
  contentText,
  filenameId,
  numberedEvent,
  parseJsonl,
  tokenCount,
} from "./shared";

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
      hierarchy: (rows) => {
        const meta = record(
          rows.find((row) => row.type === "session_meta")?.payload,
        );
        const spawn = record(record(meta?.source)?.subagent);
        const threadSpawn = record(spawn?.thread_spawn);
        const parentExternalId =
          stringValue(meta?.parent_thread_id) ??
          stringValue(threadSpawn?.parent_thread_id);
        return parentExternalId
          ? {
              parentExternalId,
              sessionKind: "subagent",
              agentLabel:
                stringValue(meta?.agent_nickname) ??
                stringValue(threadSpawn?.agent_nickname) ??
                stringValue(meta?.agent_path),
              agentDepth:
                typeof threadSpawn?.depth === "number" ? threadSpawn.depth : 1,
            }
          : { sessionKind: "main", agentDepth: 0 };
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
      terminalStatus: (rows) => {
        for (const row of [...rows].reverse()) {
          const type = record(row.payload)?.type;
          if (type === "task_complete") return "completed";
          if (type === "turn_aborted") return "interrupted";
          if (type === "task_started") return undefined;
        }
        return undefined;
      },
      // token_count events carry cumulative totals (last one wins);
      // cached_input_tokens is a subset of input_tokens, and output_tokens
      // already includes reasoning tokens. The session total is attributed
      // to the model the turns ran on (majority of turn_context rows).
      usage: (rows) => {
        let cumulative: Record<string, unknown> | undefined;
        const turnModels = new Map<string, number>();
        for (const row of rows) {
          const payload = record(row.payload);
          if (payload?.type === "token_count") {
            cumulative =
              record(record(payload.info)?.total_token_usage) ?? cumulative;
          }
          if (row.type === "turn_context") {
            const model = stringValue(payload?.model);
            if (model) turnModels.set(model, (turnModels.get(model) ?? 0) + 1);
          }
        }
        if (!cumulative) return [];
        const model =
          [...turnModels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
          stringValue(
            record(rows.find((row) => row.type === "session_meta")?.payload)
              ?.model,
          );
        if (!model) return [];
        const cacheRead = tokenCount(cumulative.cached_input_tokens);
        return [
          {
            model,
            inputTokens: Math.max(
              0,
              tokenCount(cumulative.input_tokens) - cacheRead,
            ),
            outputTokens: tokenCount(cumulative.output_tokens),
            cacheReadTokens: cacheRead,
            cacheWriteTokens: 0,
          },
        ];
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
