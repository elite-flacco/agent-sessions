import type { CapabilityUsage, ProviderAdapter } from "@/lib/types";
import { getCodexThreadTitle } from "@/lib/codex-db";
import {
  capabilityTimestamp,
  matchedSkillReads,
  mcpUsage,
} from "../capabilities";
import {
  codexDelegationInput,
  homePath,
  record,
  safeTitle,
  stringValue,
  walkJsonl,
} from "../utils";
import {
  contentText,
  filenameId,
  numberedEvent,
  parseJsonl,
  timestamp,
  tokenCount,
} from "./shared";

function functionInput(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export const codexAdapter: ProviderAdapter = {
  provider: "codex",
  discover: () => walkJsonl(homePath(".codex", "sessions")),
  parse: async (filePath, context) => {
    const result = await parseJsonl(filePath, {
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
            const title = codexDelegationInput(candidate) ?? candidate;
            if (safeTitle(title, "")) return title;
          }
        }
        // Subagent rollouts carry their task prompt as encrypted inter-agent
        // payload, so the only readable name is the spawn's agent_path
        // (e.g. "/root/task_1_bootstrap").
        const meta = record(
          rows.find((row) => row.type === "session_meta")?.payload,
        );
        const spawn = record(
          record(record(meta?.source)?.subagent)?.thread_spawn,
        );
        const agentPath =
          stringValue(meta?.agent_path) ?? stringValue(spawn?.agent_path);
        const task = agentPath?.split("/").filter(Boolean).at(-1);
        if (!task) return undefined;
        const label = task.replace(/[_-]+/g, " ").trim();
        return label.charAt(0).toUpperCase() + label.slice(1);
      },
      terminalStatus: (rows) => {
        for (const row of [...rows].reverse()) {
          const type = record(row.payload)?.type;
          if (type === "task_complete") return { status: "completed" };
          if (type === "turn_aborted") return { status: "interrupted" };
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
      // A session with no token usage (e.g. an automation that failed before
      // any turn ran) still records the model it ran on in turn_context; fall
      // back to session_meta. Lets such sessions show a model instead of blank.
      model: (rows) => {
        const turnModels = new Map<string, number>();
        for (const row of rows) {
          if (row.type !== "turn_context") continue;
          const model = stringValue(record(row.payload)?.model);
          if (model) turnModels.set(model, (turnModels.get(model) ?? 0) + 1);
        }
        return (
          [...turnModels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
          stringValue(
            record(rows.find((row) => row.type === "session_meta")?.payload)
              ?.model,
          )
        );
      },
      capabilityUsage: (rows) =>
        rows.flatMap((row, rowIndex) => {
          const payload = record(row.payload);
          const callType = stringValue(payload?.type);
          if (
            !payload ||
            row.type !== "response_item" ||
            (callType !== "function_call" && callType !== "custom_tool_call")
          )
            return [];
          const occurredAt = capabilityTimestamp(timestamp(row));
          if (!occurredAt) return [];
          const externalId =
            stringValue(payload.call_id) ??
            stringValue(row.uuid) ??
            stringValue(row.id) ??
            `${rowIndex}-0`;
          const input = functionInput(
            callType === "custom_tool_call" ? payload.input : payload.arguments,
          );
          return [
            mcpUsage({
              externalId,
              toolName: payload.name,
              namespace: payload.namespace,
              occurredAt,
              lookup: context?.capabilities,
            }),
            ...matchedSkillReads({
              externalId,
              toolName: payload.name,
              input,
              occurredAt,
              lookup: context?.capabilities,
            }),
          ].filter((entry): entry is CapabilityUsage => entry !== undefined);
        }),
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
          if (
            row.type === "response_item" &&
            (type === "function_call" || type === "custom_tool_call")
          ) {
            const event = numberedEvent(
              row,
              index,
              "tool",
              `Used ${stringValue(payload?.name) ?? "a tool"}`,
            );
            return [
              {
                ...event,
                externalId: stringValue(payload?.call_id) ?? event.externalId,
              },
            ];
          }
          return [];
        }),
    });
    const session = result.sessions[0];
    if (session?.externalId) {
      const title = getCodexThreadTitle(session.externalId);
      if (title)
        session.title = safeTitle(
          codexDelegationInput(title) ?? title,
          session.title,
        );
    }
    return result;
  },
};
