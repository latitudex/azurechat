/**
 * Shared core for sandbox-URL rewriting. Used by both:
 *   - sandbox-url-transform.ts (stream-time, AI SDK experimental_transform)
 *   - rewrite-sandbox-urls.ts (onFinish, UIMessage tree)
 *
 * Why this exists: an architect review flagged that the two callers had
 * slightly different ideas of which tool outputs to harvest and what
 * constitutes a "match" — divergent in-session vs persisted output for the
 * same conversation. This module is the single source of truth.
 */

/**
 * The sandbox URLs Azure's Responses API emits look like:
 *   sandbox:/mnt/data/plot-3f7b.png
 * The pattern is greedy up to whitespace, paren, quote, or apostrophe so
 * the rewrite works inside markdown image links and inside HTML attrs.
 */
export const SANDBOX_PATTERN = /sandbox:\/mnt\/data\/([^\s)"']+)/g;

/** Tool names that emit sandbox URLs we know how to resolve. */
const SANDBOX_TOOL_NAMES = new Set([
  "code_interpreter",
  "image_generation",
]);

export interface SandboxImageOutput {
  type: "image";
  url: string;
  filename?: string;
}

export type SandboxToolOutputItem =
  | SandboxImageOutput
  | { type: "logs"; logs: string }
  | { type: string; [key: string]: unknown };

export interface SandboxToolOutput {
  outputs?: SandboxToolOutputItem[];
}

/** True for any tool-event/part that can legally emit sandbox file URLs. */
export function isSandboxEmittingToolName(name: string | undefined): boolean {
  return !!name && SANDBOX_TOOL_NAMES.has(name);
}

/**
 * Pulls every concrete `filename → url` pair out of a single tool output.
 * Mutates `fileMap` in place. Sandbox URLs are skipped because they're not
 * fetchable from a browser; only resolved (https) URLs are recorded.
 */
export function harvestOutput(
  output: SandboxToolOutput | undefined,
  fileMap: Map<string, string>,
): void {
  const outputs = output?.outputs ?? [];
  for (const out of outputs) {
    if (out.type !== "image") continue;
    const image = out as SandboxImageOutput;
    const filename =
      image.filename ?? image.url.split("/").pop()?.split("?")[0];
    if (filename && image.url && !image.url.startsWith("sandbox:")) {
      fileMap.set(filename, image.url);
    }
  }
}

/**
 * Returns `{ fileId, containerId, filename }` if `meta` carries the
 * `container_file_citation` shape `@ai-sdk/openai` attaches to document
 * sources, else null. Accepts the metadata under either the `openai` or
 * `azure` provider key since `@ai-sdk/azure` routes through the openai
 * responses provider.
 */
export function readContainerFileCitation(
  meta: unknown,
  filename: string | undefined,
): { fileId: string; containerId: string; filename: string } | null {
  if (!filename || !meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  const inner = (m.openai ?? m.azure) as Record<string, unknown> | undefined;
  if (!inner || inner.type !== "container_file_citation") return null;
  const { fileId, containerId } = inner;
  if (typeof fileId !== "string" || typeof containerId !== "string") return null;
  return { fileId, containerId, filename };
}

/**
 * Rewrites every sandbox-URL occurrence in `text` using `fileMap`. Filenames
 * absent from the map are appended to `unresolved` and left intact in the
 * returned text — markdown still renders, just with a broken image. Returns
 * the input string by reference when nothing changed.
 */
export function rewriteSandboxText(
  text: string,
  fileMap: Map<string, string>,
  unresolved: string[] = [],
): string {
  if (fileMap.size === 0 && !SANDBOX_PATTERN.test(text)) {
    // Reset lastIndex from the .test() above so the next .replace() works.
    SANDBOX_PATTERN.lastIndex = 0;
    return text;
  }
  SANDBOX_PATTERN.lastIndex = 0;
  const rewritten = text.replace(SANDBOX_PATTERN, (match, filename: string) => {
    const url = fileMap.get(filename);
    if (url) return url;
    unresolved.push(filename);
    return match;
  });
  return rewritten;
}
