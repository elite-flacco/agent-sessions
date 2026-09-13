import type { CapabilityUsage, ProviderAdapter } from "@/lib/types";
import { getCodexThreadTitle } from "@/lib/codex-db";
import ts from "typescript";
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
    // Recent Codex desktop sessions serialize the execution wrapper itself,
    // e.g. `await tools.exec_command({"cmd":"sed ..."})`, rather than the
    // command arguments as JSON. Extract only its command-string values so
    // capability matching still sees the command that actually ran.
    const commands = [
      ...value.matchAll(/(?:"cmd"|'cmd'|\bcmd)\s*:\s*("(?:\\.|[^"\\])*")/g),
    ].flatMap((match) => {
      try {
        return [JSON.parse(match[1]) as string];
      } catch {
        return [];
      }
    });
    return commands.length ? commands : value;
  }
}

// Completion records enrich existing invocations; they are not additional uses.
function pluginAttributions(
  rows: { type?: unknown; payload?: unknown }[],
): Map<string, string | null> {
  const plugins = new Map<string, string | null>();
  for (const row of rows) {
    const payload = record(row.payload);
    const item = record(payload?.item);
    if (
      row.type !== "event_msg" ||
      payload?.type !== "item_completed" ||
      item?.type !== "McpToolCall"
    )
      continue;
    const { id, server, tool, pluginId } = item;
    if (
      ![id, server, tool, pluginId].every((value) => typeof value === "string")
    )
      continue;
    const key = JSON.stringify([id, server, tool]);
    const previous = plugins.get(key);
    plugins.set(
      key,
      previous === undefined || previous === pluginId
        ? (pluginId as string)
        : null,
    );
  }
  return plugins;
}

function attributedPlugin(
  payload: Record<string, unknown>,
  plugins: Map<string, string | null>,
): string | undefined {
  const name = stringValue(payload.name);
  const namespace = stringValue(payload.namespace);
  const parts = name?.startsWith("mcp__") ? name.split("__") : undefined;
  const server =
    parts?.[1] ??
    (namespace?.startsWith("mcp__") ? namespace.split("__")[1] : undefined);
  const tool = parts ? parts.slice(2).join("__") : name;
  return (
    plugins.get(JSON.stringify([payload.call_id, server, tool])) ?? undefined
  );
}

function executionWrapperMcpTools(
  outerToolName: unknown,
  value: unknown,
): string[] {
  if (outerToolName !== "exec" || typeof value !== "string") return [];
  const source = ts.createSourceFile(
    "codex-execution-wrapper.js",
    value,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS,
  );
  return source.statements.flatMap((statement) => {
    if (!ts.isVariableStatement(statement)) return [];
    return statement.declarationList.declarations.flatMap((declaration) => {
      const initializer = declaration.initializer;
      if (!initializer || !ts.isAwaitExpression(initializer)) return [];
      const call = initializer.expression;
      if (!ts.isCallExpression(call)) return [];
      const callee = call.expression;
      if (
        !ts.isPropertyAccessExpression(callee) ||
        !ts.isIdentifier(callee.expression) ||
        callee.expression.text !== "tools" ||
        !callee.name.text.startsWith("mcp__")
      ) {
        return [];
      }
      return [callee.name.text];
    });
  });
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
      capabilityUsage: (rows) => {
        const plugins = pluginAttributions(rows);
        return rows.flatMap((row, rowIndex) => {
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
          const rawInput =
            callType === "custom_tool_call" ? payload.input : payload.arguments;
          const input = functionInput(rawInput);
          const nestedMcpUsage = executionWrapperMcpTools(
            payload.name,
            rawInput,
          ).flatMap((toolName, toolIndex) => {
            const usage = mcpUsage({
              externalId: `${externalId}:${toolIndex}`,
              toolName,
              occurredAt,
              lookup: context?.capabilities,
            });
            return usage ? [usage] : [];
          });
          return [
            mcpUsage({
              externalId,
              toolName: payload.name,
              namespace: payload.namespace,
              pluginId: attributedPlugin(payload, plugins),
              occurredAt,
              lookup: context?.capabilities,
            }),
            ...nestedMcpUsage,
            ...matchedSkillReads({
              externalId,
              toolName: payload.name,
              input,
              occurredAt,
              lookup: context?.capabilities,
            }),
          ].filter((entry): entry is CapabilityUsage => entry !== undefined);
        });
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
