import "server-only";

import type { TextStreamPart, ToolSet } from "ai";
import { persistBase64Image } from "../chat-image-persistence-service";
import { isImageReference } from "../chat-image-persistence-utils";
import { logError, logInfo } from "@/features/common/services/logger";

/**
 * Streaming-time handler for Azure's built-in `code_interpreter` tool when it
 * emits image outputs as inline data: URLs.
 *
 * Azure's code_interpreter returns `outputs[]` containing entries shaped
 * `{ type: "image", url: "data:image/png;base64,…" }` (also occasionally
 * `sandbox:/mnt/data/<file>` URLs — those are handled by sandbox-url-transform).
 * The data: variant carries the full ~2 MB of base64 inline, and when the
 * model echoes it in a markdown link like `[Download](data:…)`,
 * Streamdown's link sanitiser blocks the href (rehype-harden rejects all
 * data: schemes inside `<a>`). The user sees "[blocked]" placeholder text
 * and no rendered image.
 *
 * This transform:
 *   1. Hands the bytes to `persistBase64Image` (the image service), which
 *      uploads to blob storage and returns the canonical `blob://threadId/filename`
 *      reference.
 *   2. Rewrites the matching `outputs[].url` to the blob ref so the chunk
 *      stays small and persistence stores a reference, not the megabyte.
 *   3. Injects `![Generated image](blob://…)` markdown into the assistant
 *      text stream so the image renders inline regardless of whether the
 *      model embeds the original URL in its prose (provider-executed
 *      tools resolve inside one Azure response — the model can't be
 *      coaxed via system prompt to use the blob ref).
 *
 * Dedupe-by-toolCallId guards against Azure's occasional duplicate emission
 * of the same tool-result (observed for image_generation, defensive here).
 * URL/ref construction stays inside the image service; this module only
 * passes the ref it was handed back.
 */
export function createCodeInterpreterStreamRewriter<TOOLS extends ToolSet>(
  threadId: string,
  /**
   * Caller-supplied map populated as data: URLs are persisted. The sandbox
   * text-delta transform reads from it to substitute data: URLs the model
   * echoes in its prose (e.g. `[Download](data:image/png;base64,…)`) with
   * the same blob ref this rewriter stored. Sharing across the two
   * transforms is the only way text-delta substitution can find the
   * already-persisted bytes without re-uploading.
   */
  dataUrlToBlobRef?: Map<string, string>,
) {
  return (): TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>> => {
    const seenToolCallIds = new Set<string>();
    return new TransformStream({
      async transform(chunk, controller) {
        if (chunk.type !== "tool-result") {
          controller.enqueue(chunk);
          return;
        }
        const typed = chunk as TextStreamPart<TOOLS> & {
          toolName?: string;
          toolCallId?: string;
          output?: unknown;
          preliminary?: boolean;
        };
        if (typed.toolName !== "code_interpreter") {
          controller.enqueue(chunk);
          return;
        }
        if (typed.preliminary) {
          controller.enqueue(chunk);
          return;
        }
        if (typed.toolCallId && seenToolCallIds.has(typed.toolCallId)) {
          logInfo("code-interp rewriter: dropping duplicate result", {
            threadId,
            toolCallId: typed.toolCallId,
          });
          return;
        }

        // Walk `outputs[]` and persist any data: image URLs. Anything else
        // (sandbox URLs, log outputs, blob refs already produced upstream)
        // passes through untouched — sandbox-url-transform handles sandbox
        // URLs, and blob refs are already canonical.
        const outputObj = typed.output as { outputs?: unknown } | undefined;
        const outputs = Array.isArray(outputObj?.outputs) ? outputObj.outputs : null;
        if (!outputs) {
          controller.enqueue(chunk);
          return;
        }

        const injectedRefs: string[] = [];
        const rewrittenOutputs = await Promise.all(
          outputs.map(async (raw) => {
            const item = raw as { type?: string; url?: string };
            if (item?.type !== "image" || typeof item.url !== "string") return raw;
            if (isImageReference(item.url)) return raw;
            if (!item.url.startsWith("data:image/")) return raw;
            try {
              const persisted = await persistBase64Image(threadId, item.url);
              if (persisted.status !== "OK") {
                logError("code-interp rewriter: persistBase64Image failed", {
                  threadId,
                  toolCallId: typed.toolCallId,
                  errors: persisted.errors,
                });
                return raw;
              }
              const blobRef = persisted.response;
              injectedRefs.push(blobRef);
              // Remember the mapping so the sandbox text-delta transform
              // can substitute matching data: URLs in the model's prose.
              dataUrlToBlobRef?.set(item.url, blobRef);
              return { ...item, url: blobRef };
            } catch (err) {
              logError("code-interp rewriter: unexpected failure", {
                threadId,
                toolCallId: typed.toolCallId,
                error: err instanceof Error ? err.message : String(err),
              });
              return raw;
            }
          }),
        );

        if (injectedRefs.length === 0) {
          // No data: image URLs in this result — pass through unchanged so
          // sandbox-url-transform's harvest still sees the original chunk.
          controller.enqueue(chunk);
          return;
        }

        if (typed.toolCallId) seenToolCallIds.add(typed.toolCallId);
        logInfo("code-interp rewriter: swapped data URLs for blob refs", {
          threadId,
          toolCallId: typed.toolCallId,
          count: injectedRefs.length,
        });

        controller.enqueue({
          ...chunk,
          output: { ...(typed.output as object), outputs: rewrittenOutputs },
        } as TextStreamPart<TOOLS>);

        // No markdown injection here — the model's own
        // `[Download](sandbox:/mnt/data/<file>)` link gets rewritten by
        // sandbox-url-transform once it ingests the matching
        // container_file_citation source chunk. Injecting our own
        // markdown alongside would render the same image twice.
      },
    });
  };
}
