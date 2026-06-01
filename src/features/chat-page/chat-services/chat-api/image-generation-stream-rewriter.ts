import "server-only";

import type { TextStreamPart, ToolSet } from "ai";
import { persistBase64Image } from "../chat-image-persistence-service";
import { isImageReference } from "../chat-image-persistence-utils";
import { logError, logInfo } from "@/features/common/services/logger";

/**
 * Streaming-time handler for Azure's built-in `image_generation` tool.
 *
 * Azure emits the generated image as raw base64 inside the tool-result
 * chunk's `output.result` (~2 MB per 1024² PNG). This transform:
 *
 *   1. Persists the bytes via the image service (`persistBase64Image`)
 *      and gets back the canonical `blob://threadId/filename` reference.
 *   2. Rewrites the tool-result chunk's `output.result` to that ref so
 *      the SSE pipe, `event.toolResults`, and Cosmos persistence all
 *      carry the small reference instead of the megabyte of base64.
 *   3. Injects `![Generated image](blob://…)` markdown into the
 *      assistant's text stream (legacy pre-migration behaviour from
 *      `openai-responses-stream.ts`). The model itself never sees the
 *      blob ref — provider-executed tools resolve inside one Azure
 *      response, so the model can't be coaxed into embedding the URL.
 *      The renderer (`RichResponse`) resolves `blob://` → `/api/images?…`
 *      at render time.
 *
 * Two filters keep duplicates out:
 *   - `preliminary` chunks (partial-image previews) are dropped; the
 *     paired `partialImages: 0` in `provider-seam.ts` asks Azure not to
 *     send them, this is a backstop.
 *   - The same `toolCallId` arriving twice (verified: identical 2.3MB
 *     payloads ~27s apart from Azure) is deduped — first wins.
 *
 * URL/ref string construction is delegated to the image service —
 * this module just plumbs whatever ref `persistBase64Image` hands back.
 */

const TEXT_BASE64_HEURISTIC_MIN_LEN = 256;

/** Detects the bare-base64 (or `data:…;base64,…`) payload in a tool result's `output.result`. */
function extractBareBase64(
  output: unknown,
): { base64: string; mimeType: string } | null {
  if (!output || typeof output !== "object") return null;
  const result = (output as { result?: unknown }).result;
  if (typeof result !== "string" || result.length === 0) return null;
  // Already canonical — caller should pass through unchanged.
  if (isImageReference(result)) return null;
  const dataUrlMatch = /^data:([^;]+);base64,/i.exec(result);
  if (dataUrlMatch) return { base64: result, mimeType: dataUrlMatch[1] };
  if (result.length < TEXT_BASE64_HEURISTIC_MIN_LEN) return null;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(result.slice(0, 64))) return null;
  return { base64: result, mimeType: "image/png" };
}

export function createImageGenerationStreamRewriter<TOOLS extends ToolSet>(
  threadId: string,
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
        if (typed.toolName !== "image_generation") {
          controller.enqueue(chunk);
          return;
        }
        if (typed.preliminary) {
          logInfo("image-gen rewriter: dropping preliminary chunk", {
            threadId,
            toolCallId: typed.toolCallId,
          });
          return;
        }
        if (typed.toolCallId && seenToolCallIds.has(typed.toolCallId)) {
          logInfo("image-gen rewriter: dropping duplicate result", {
            threadId,
            toolCallId: typed.toolCallId,
          });
          return;
        }
        const payload = extractBareBase64(typed.output);
        if (!payload) {
          controller.enqueue(chunk);
          return;
        }
        if (typed.toolCallId) seenToolCallIds.add(typed.toolCallId);

        try {
          const dataUrl = payload.base64.startsWith("data:")
            ? payload.base64
            : `data:${payload.mimeType};base64,${payload.base64}`;
          const stored = await persistBase64Image(threadId, dataUrl);
          if (stored.status !== "OK") {
            logError("image-gen rewriter: persistBase64Image failed", {
              threadId,
              toolCallId: typed.toolCallId,
              errors: stored.errors,
            });
            controller.enqueue(chunk);
            return;
          }
          const blobRef = stored.response;
          logInfo("image-gen rewriter: swapped base64 for blob ref", {
            threadId,
            toolCallId: typed.toolCallId,
            blobRef,
          });

          // Rewrite the tool-result chunk so consumers downstream of this
          // transform see the blob ref instead of the base64.
          controller.enqueue({
            ...chunk,
            output: { ...(typed.output as object), result: blobRef },
          } as TextStreamPart<TOOLS>);

          // Inject markdown image into the assistant text stream so the
          // image renders inline in the reply (the provider-executed
          // model never sees the blob ref itself). text-start / text-end
          // bookends required by the AI SDK around any text-delta.
          const textPartId = `imagegen-${typed.toolCallId ?? Date.now()}`;
          controller.enqueue({ type: "text-start", id: textPartId } as TextStreamPart<TOOLS>);
          controller.enqueue({
            type: "text-delta",
            id: textPartId,
            text: `\n\n![Generated image](${blobRef})\n\n`,
          } as TextStreamPart<TOOLS>);
          controller.enqueue({ type: "text-end", id: textPartId } as TextStreamPart<TOOLS>);
        } catch (err) {
          logError("image-gen rewriter: unexpected failure", {
            threadId,
            toolCallId: typed.toolCallId,
            error: err instanceof Error ? err.message : String(err),
          });
          controller.enqueue(chunk);
        }
      },
    });
  };
}
