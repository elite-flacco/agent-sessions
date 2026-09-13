import { join } from "node:path";
import { redactPayload } from "@/lib/transcript";
import { readJsonSource } from "./shared";
import type { AgentCapability, InventoryWarning } from "./types";

function displayText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = String(redactPayload(value))
    .split(/\r?\n/)[0]
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim();
  return text ? text.slice(0, maxLength) : undefined;
}

/** Read only public presentation fields at an already-discovered plugin root. */
export async function readPluginPresentation(
  root: string,
  warnings: InventoryWarning[],
): Promise<Pick<AgentCapability, "displayName" | "description">> {
  for (const relativePath of [
    ".codex-plugin/plugin.json",
    ".claude-plugin/plugin.json",
    "plugin.json",
  ]) {
    // User-local plugin metadata is discovered at runtime, never bundled.
    const manifest = await readJsonSource(
      join(/* turbopackIgnore: true */ root, relativePath),
      warnings,
    );
    if (!manifest) continue;
    const ui =
      manifest.interface && typeof manifest.interface === "object"
        ? (manifest.interface as Record<string, unknown>)
        : {};
    const displayName =
      displayText(ui.displayName, 160) ?? displayText(manifest.name, 160);
    const description =
      displayText(ui.shortDescription, 240) ??
      displayText(manifest.description, 240);
    return {
      ...(displayName ? { displayName } : {}),
      ...(description ? { description } : {}),
    };
  }
  return {};
}
