import type { UIMessage } from "ai";
import {
  harvestOutput,
  isSandboxEmittingToolName,
  rewriteSandboxText,
  type SandboxToolOutput,
} from "./sandbox-rewrite-core";

/**
 * rewrite-sandbox-urls.ts
 *
 * Azure's Responses API code-interpreter / image-generation tools emit file
 * outputs that the model references in its prose as `sandbox:/mnt/data/<file>`
 * markdown links. Those URLs are not fetchable from a browser.
 *
 * This module is the onFinish-time rewriter that walks the UIMessage tree
 * AI SDK hands to `onFinish` and rewrites sandbox URLs in text parts using
 * filename → URL pairs derived from the message's own tool outputs PLUS an
 * optional caller-supplied map of pre-ingested files. The onFinish handler
 * uses the latter to pass URLs for code_interpreter container files it
 * round-tripped into the chat file store (download from container → upload
 * to chat-image-service → URL); only that one path exists for producing
 * those URLs.
 *
 * It shares ./sandbox-rewrite-core.ts with the stream-time transform so the
 * two paths cannot drift on which tools to harvest from or what counts as a
 * match.
 */

/**
 * Walks `messages[].parts` looking for code_interpreter / image_generation
 * tool parts and harvests every `filename → url` pair the AI SDK has handed
 * us. Recognises both `tool-<name>` parts and `dynamic-tool` wrappers.
 */
function harvestFileMap(message: UIMessage): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of message.parts) {
    const p = part as {
      type: string;
      toolName?: string;
      output?: SandboxToolOutput;
    };
    const matches =
      (p.type.startsWith("tool-") &&
        isSandboxEmittingToolName(p.type.replace(/^tool-/, ""))) ||
      (p.type === "dynamic-tool" && isSandboxEmittingToolName(p.toolName));
    if (matches) {
      harvestOutput(p.output, map);
    }
  }
  return map;
}

/**
 * Returns a new UIMessage with sandbox URLs in text parts replaced by stored
 * URLs. The map of filename → URL is built from two sources, merged in this
 * order (later wins):
 *   1. Harvested from the message's own tool-output / source-document parts.
 *   2. The optional `preIngested` map — the route's onFinish handler uses
 *      this to pass URLs it produced by downloading container files and
 *      uploading them to the chat file store before this rewrite runs.
 */
export function rewriteSandboxUrlsInMessage(
  message: UIMessage,
  preIngested?: Map<string, string>,
): {
  message: UIMessage;
  unresolved: string[];
} {
  if (message.role !== "assistant") {
    return { message, unresolved: [] };
  }

  const fileMap = harvestFileMap(message);
  if (preIngested) {
    for (const [k, v] of preIngested) fileMap.set(k, v);
  }
  const unresolved: string[] = [];

  const newParts = message.parts.map((part) => {
    if (part.type !== "text") return part;
    const textPart = part as { type: "text"; text: string };
    const rewritten = rewriteSandboxText(textPart.text, fileMap, unresolved);
    if (rewritten === textPart.text) return part;
    return { ...textPart, text: rewritten };
  });

  if (newParts.every((p, i) => p === message.parts[i])) {
    return { message, unresolved };
  }
  return { message: { ...message, parts: newParts } as UIMessage, unresolved };
}

/**
 * Convenience for the route's onFinish: applies the rewrite to every
 * message in the conversation and returns the new array + a flat list of
 * any filenames the rewriter could not resolve. `preIngested` overrides
 * harvested URLs for the same filename across every message.
 */
export function rewriteSandboxUrls(
  messages: UIMessage[],
  preIngested?: Map<string, string>,
): {
  messages: UIMessage[];
  unresolved: string[];
} {
  const unresolved: string[] = [];
  const out = messages.map((m) => {
    const r = rewriteSandboxUrlsInMessage(m, preIngested);
    unresolved.push(...r.unresolved);
    return r.message;
  });
  return { messages: out, unresolved };
}
