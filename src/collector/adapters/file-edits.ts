/**
 * Derives how much code a session changed from its edit tool calls.
 *
 * Only the counts leave this module. Adapters must never return raw tool
 * arguments, and a file path is a tool argument, so paths are used to size the
 * changed-file set and then discarded; the transcript boundary remains the
 * only place a path is exposed, with redaction applied.
 */

export interface ToolInvocation {
  name: string;
  input: unknown;
}

export interface FileEditStats {
  filesChanged: number;
  additions: number;
  deletions: number;
}

type EditKind = "replace" | "multi" | "create" | "patch";

const EDIT_TOOLS: Record<string, EditKind> = {
  edit: "replace",
  streplace: "replace",
  strreplaceeditor: "replace",
  editfile: "replace",
  multiedit: "multi",
  write: "create",
  writefile: "create",
  createfile: "create",
  notebookedit: "replace",
  applypatch: "patch",
  patch: "patch",
};

const PATH_KEYS = [
  "file_path",
  "filePath",
  "path",
  "notebook_path",
  "notebookPath",
] as const;

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Tool inputs arrive either parsed or as a JSON string, depending on source. */
function parseInput(input: unknown): unknown {
  const raw = text(input);
  if (raw === undefined) return input;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function lineCount(value: unknown): number {
  const raw = text(value);
  if (!raw) return 0;
  const trimmed = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
  return trimmed.length ? trimmed.split("\n").length : 0;
}

function pathOf(input: Record<string, unknown>): string | undefined {
  for (const key of PATH_KEYS) {
    const value = text(input[key]);
    if (value) return value;
  }
  return undefined;
}

const PATCH_FILE = /^\*\*\*\s+(?:Add|Update|Delete)\s+File:\s*(.+)$/;

/** Count a Codex-style `apply_patch` envelope. */
function countPatch(
  patch: string,
  files: Set<string>,
): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    const file = PATCH_FILE.exec(line);
    if (file) {
      files.add(file[1].trim());
      continue;
    }
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

export function fileEditStats(
  calls: Iterable<ToolInvocation>,
): FileEditStats | undefined {
  const files = new Set<string>();
  let additions = 0;
  let deletions = 0;
  let sawEdit = false;

  for (const call of calls) {
    const kind = EDIT_TOOLS[normalizeName(call.name)];
    if (!kind) continue;
    const parsed = parseInput(call.input);

    if (kind === "patch") {
      const patch =
        text(parsed) ??
        text(record(parsed)?.patch) ??
        text(record(parsed)?.input);
      if (!patch) continue;
      sawEdit = true;
      const counted = countPatch(patch, files);
      additions += counted.additions;
      deletions += counted.deletions;
      continue;
    }

    const input = record(parsed);
    if (!input) continue;
    const path = pathOf(input);
    if (path) files.add(path);
    sawEdit = true;

    if (kind === "create") {
      additions += lineCount(input.content ?? input.contents ?? input.text);
      continue;
    }
    const edits =
      kind === "multi" && Array.isArray(input.edits)
        ? input.edits.flatMap((item) => {
            const edit = record(item);
            return edit ? [edit] : [];
          })
        : [input];
    for (const edit of edits) {
      additions += lineCount(edit.new_string ?? edit.newString ?? edit.new_str);
      deletions += lineCount(edit.old_string ?? edit.oldString ?? edit.old_str);
    }
  }

  // No edit tools at all means "unknown", which must stay NULL rather than
  // claiming the session changed nothing.
  if (!sawEdit) return undefined;
  return { filesChanged: files.size, additions, deletions };
}
