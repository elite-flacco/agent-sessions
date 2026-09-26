import type { TranscriptEntry } from "./transcript";

/**
 * Tool calls that describe the agent's trajectory rather than doing work:
 * the plan it is keeping, the questions it stopped to ask, and the skills
 * that mark a change of phase. Rendering these as ordinary rows buries the
 * only running commentary a session has about its own shape.
 */
export type MarkerKind = "plan" | "decision" | "phase";

const MARKER_TOOLS: Record<string, MarkerKind> = {
  todowrite: "plan",
  updatetodos: "plan",
  askuserquestion: "decision",
  skill: "phase",
};

function normalizeToolName(title: string): string {
  return title.toLowerCase().replace(/[^a-z]/g, "");
}

export function markerKind(entry: TranscriptEntry): MarkerKind | null {
  if (entry.kind !== "tool") return null;
  return MARKER_TOOLS[normalizeToolName(entry.title)] ?? null;
}

const DELEGATION_TOOLS = new Set(["agent", "task", "dispatchagent"]);

/** A tool call that handed work to a child session. */
export function isDelegationCall(entry: TranscriptEntry): boolean {
  return (
    entry.kind === "tool" &&
    DELEGATION_TOOLS.has(normalizeToolName(entry.title))
  );
}

function parseJson(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The payloads wrap quoted text across lines, so a naive whitespace collapse
 * leaves `render ?` and `(Recommended )`. Close the gaps around punctuation.
 */
function collapse(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+([?!.,;:)\]}])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .trim();
}

/**
 * The result wraps its quoted question across lines, so a question can come
 * back as `render\n?` where the input had `render?`. Match on the text with
 * all whitespace removed and keep `collapse` for display.
 */
function matchKey(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

interface Todo {
  content: string;
  status: string;
}

function todos(value: unknown): Todo[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const content =
      text(record.content) ?? text(record.task) ?? text(record.title);
    if (!content) return [];
    return [{ content, status: text(record.status) ?? "pending" }];
  });
}

export interface PlanDiff {
  completed: string[];
  started: string[];
  added: string[];
  done: number;
  total: number;
}

/**
 * What changed in the plan at this step. The tool's own result carries the
 * previous list, so each entry is self-describing — no need to thread state
 * through the transcript.
 */
export function parsePlanDiff(entry: TranscriptEntry): PlanDiff | null {
  const output = parseJson(entry.output);
  const input = parseJson(entry.input);
  const next = todos(output?.todos ?? input?.todos);
  if (!next.length) return null;
  const previous = todos(output?.oldTodos ?? output?.previousTodos);
  const before = new Map(previous.map((todo) => [todo.content, todo.status]));
  const completed: string[] = [];
  const started: string[] = [];
  const added: string[] = [];
  // One bucket per item: a new item that is already in progress is better
  // described as started than as added, and listing it twice reads as noise.
  for (const todo of next) {
    const was = before.get(todo.content);
    if (todo.status === "completed" && was !== "completed")
      completed.push(todo.content);
    else if (todo.status === "in_progress" && was !== "in_progress")
      started.push(todo.content);
    else if (was === undefined) added.push(todo.content);
  }
  return {
    completed,
    started,
    // A brand-new list is not a list of additions; it is the plan itself.
    added: previous.length ? added : [],
    done: next.filter((todo) => todo.status === "completed").length,
    total: next.length,
  };
}

export interface DecisionDetail {
  header: string | null;
  question: string;
  answer: string | null;
  optionCount: number;
}

/**
 * The answer only comes back as prose (`"<question>"="<answer>"`), so match
 * the pairs and fall back to showing the question alone.
 */
export function parseDecisions(entry: TranscriptEntry): DecisionDetail[] {
  const input = parseJson(entry.input);
  const questions = Array.isArray(input?.questions) ? input.questions : [];
  const answers = new Map<string, { question: string; answer: string }>();
  if (entry.output) {
    const pattern = /"([\s\S]*?)"\s*=\s*"([\s\S]*?)"/g;
    let match = pattern.exec(entry.output);
    while (match) {
      answers.set(matchKey(match[1]), {
        question: collapse(match[1]),
        answer: collapse(match[2]),
      });
      match = pattern.exec(entry.output);
    }
  }
  const details = questions.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const question = text(record.question);
    if (!question) return [];
    return [
      {
        header: text(record.header),
        question: collapse(question),
        answer: answers.get(matchKey(question))?.answer ?? null,
        optionCount: Array.isArray(record.options) ? record.options.length : 0,
      },
    ];
  });
  if (details.length) return details;
  // No structured input: surface whatever pairs the result carried.
  return [...answers.values()].map(({ question, answer }) => ({
    header: null,
    question,
    answer,
    optionCount: 0,
  }));
}

export interface PhaseDetail {
  skill: string;
  args: string | null;
}

export function parsePhase(entry: TranscriptEntry): PhaseDetail | null {
  const input = parseJson(entry.input);
  const skill = text(input?.skill) ?? text(input?.name) ?? text(input?.command);
  if (!skill) return null;
  const args = text(input?.args);
  return { skill, args: args ? collapse(args) : null };
}
