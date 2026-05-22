/**
 * /api/chat — AI SDK v6 streamText route.
 *
 * Built-in Azure server-side tools (code_interpreter, image_generation,
 * web_search_preview) ARE exposed by @ai-sdk/azure v3 via azure.tools.*
 * — confirmed from node_modules/@ai-sdk/azure/dist/index.d.ts which re-exports
 * them from @ai-sdk/openai/internal as azureOpenaiTools, accessible as
 * azure.tools.codeInterpreter / .imageGeneration / .webSearchPreview.
 * Included conditionally based on ctx.defaultTools toggles.
 */

import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  createIdGenerator,
} from "ai";
import type { ToolSet } from "ai";
import { validateMultimodalInput } from "@/features/chat-page/chat-services/chat-api/validate-input";
import { resolveModelAndLimits } from "@/features/chat-page/chat-services/chat-api/model-selection";
import { loadThreadContext } from "@/features/chat-page/chat-services/chat-api/thread-context";
import { persistAssistantFromFinishEvent } from "@/features/chat-page/chat-services/chat-api/persist-assistant";
import { consumeRateLimitToken } from "@/features/chat-page/chat-services/chat-api/rate-limit";
import { resolveRateLimitSubject } from "@/features/chat-page/chat-services/chat-api/rate-limit-subject";
import { createSandboxUrlTransform } from "@/features/chat-page/chat-services/chat-api/sandbox-url-transform";
import { createImageGenerationStreamRewriter } from "@/features/chat-page/chat-services/chat-api/image-generation-stream-rewriter";
import { createCodeInterpreterStreamRewriter } from "@/features/chat-page/chat-services/chat-api/code-interpreter-stream-rewriter";
import { resolveProvider } from "@/features/chat-page/chat-services/models/provider-seam";
import { UpdateChatTitle } from "@/features/chat-page/chat-services/chat-thread-service";
import { buildToolset } from "@/features/chat-page/chat-services/tools/registry";
import {
  startPublisher,
  unregisterPublisher,
} from "@/features/chat-page/chat-services/chat-api/stream-publisher";
import { enforceSameOriginRequest } from "@/features/chat-page/chat-services/chat-api/same-origin";
import {
  buildSystemMessage,
  isoDate,
} from "@/features/chat-page/chat-services/chat-api/prompt-builder";
import { CHAT_DEFAULT_SYSTEM_PROMPT } from "@/features/theme/theme-config";
import {
  FindAllExtensionForCurrentUserAndIds,
  FindSecureHeaderValue,
} from "@/features/extensions-page/extension-services/extension-service";
import { logError, logInfo, logWarn } from "@/features/common/services/logger";
import { DEFAULT_MODEL, type UserPrompt } from "@/features/chat-page/chat-services/models";

// Allow streaming responses to run for up to 10 minutes (600 seconds)
export const maxDuration = 600;

/**
 * Distill a useful error message from a stream event when AI SDK reports
 * `finishReason: "error"` without firing `onError`. Mines two sources:
 * `event.warnings` (the AI SDK's CallWarning array) and
 * `event.providerMetadata` (provider-specific error payload under
 * `openai` / `azure`). Returns null when neither carries anything usable.
 */
function reconstructStreamError(
  event: {
    warnings?: ReadonlyArray<{ message?: string } | unknown>;
    providerMetadata?: Record<string, Record<string, unknown>>;
  },
): { message: string; name: string } | null {
  const provider = event.providerMetadata;
  const providerError =
    provider?.openai?.error ?? provider?.azure?.error;
  const providerErrorMessage =
    typeof providerError === "string"
      ? providerError
      : (providerError as { message?: string } | undefined)?.message;
  const warningMessages = (event.warnings ?? [])
    .map((w) => (w as { message?: string } | undefined)?.message)
    .filter((m): m is string => typeof m === "string" && m.length > 0)
    .join("; ");
  const synthesized = providerErrorMessage || warningMessages;
  return synthesized ? { message: synthesized, name: "ProviderError" } : null;
}

// Hard upper bound on the multipart body. validateMultimodalInput enforces a
// 20MB per-image cap, but a max of 16 images × 20MB = 320MB still arrives in
// memory before per-image checks run. The cap below short-circuits that path.
const MAX_REQUEST_BYTES = 50 * 1024 * 1024;

export async function POST(req: Request) {
  // CSRF defense: reject cross-origin POSTs. See same-origin.ts.
  const originCheck = enforceSameOriginRequest(req);
  if (originCheck) return originCheck;

  // Body-size guard. experimental.serverActions.bodySizeLimit covers only
  // Server Actions, NOT route handlers — without this check a single
  // multipart upload can pin a container with hundreds of MB before the
  // per-image validator runs.
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return new Response("Request body too large", { status: 413 });
  }

  // Cost-bomb defense: token bucket keyed on a "subject" abstraction so
  // we can swap to per-org or per-tenant limits without touching this
  // handler (architect2 SEV-2 B11). Refuse before doing any Cosmos
  // reads or LLM provisioning so a runaway client can't pin the
  // container with cheap work either.
  let rateLimitKey: string;
  try {
    rateLimitKey = await resolveRateLimitSubject();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  const rateLimit = consumeRateLimitToken(rateLimitKey);
  if (rateLimit.allowed === false) {
    return new Response("Rate limit exceeded", {
      status: 429,
      headers: { "retry-after": String(rateLimit.retryAfterSeconds) },
    });
  }

  const form = await req.formData();
  const images = form
    .getAll("image-base64")
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  const validation = validateMultimodalInput(images);
  if (validation.ok === false) {
    return new Response(validation.error, { status: validation.status });
  }

  const payload: UserPrompt = {
    ...JSON.parse(form.get("content") as string),
    multimodalImages: images,
    multimodalImage: images[0] ?? "",
  };

  let ctx: Awaited<ReturnType<typeof loadThreadContext>>;
  try {
    ctx = await loadThreadContext(payload);
  } catch (err) {
    logError("/api/chat: loadThreadContext failed", {
      error: err,
      message: err instanceof Error ? err.message : String(err),
    });
    const status = (err as { status?: number })?.status ?? 500;
    return new Response(
      status === 401 ? "Unauthorized" : "Failed to load thread context",
      { status },
    );
  }

  const { modelConfig, fallbackInfo, effectiveReasoningEffort } =
    await resolveModelAndLimits(payload, ctx.thread);

  // Resolve effective tool toggles up-front: per-request payload overrides the
  // thread's persisted defaultTools (the request body is the authoritative
  // user intent for this turn, since the UI toggles update local state and
  // may not have been persisted to the thread yet). Needed early so the
  // system prompt can add tool-specific instructions (e.g. image_generation
  // → embed result inline as markdown image).
  const effectiveTools = {
    codeInterpreter:
      payload.codeInterpreterEnabled ?? ctx.defaultTools?.codeInterpreter ?? false,
    imageGeneration:
      payload.imageGenerationEnabled ?? ctx.defaultTools?.imageGeneration ?? false,
    webSearch:
      payload.webSearchEnabled ?? ctx.defaultTools?.webSearch ?? false,
  };

  const system = buildSystemMessage({
    staticSystemPrompt: CHAT_DEFAULT_SYSTEM_PROMPT,
    personaMessage: ctx.thread.personaMessage ?? "",
    today: isoDate(),
    documentHint: ctx.documentHint,
  });

  // Resolve extension IDs → full objects with header secrets for buildToolset
  type ResolvedExt = Parameters<typeof buildToolset>[0]["extensions"][number];
  const resolvedExtensions: ResolvedExt[] = [];
  if (ctx.extensions.length > 0) {
    const extResp = await FindAllExtensionForCurrentUserAndIds(ctx.extensions);
    if (extResp.status === "OK") {
      for (const ext of extResp.response) {
        const headerSecrets: Record<string, string> = {};
        for (const h of ext.headers) {
          const v = await FindSecureHeaderValue(h.id);
          if (v.status === "OK") headerSecrets[h.key] = v.response;
          else logWarn("/api/chat: failed to resolve extension header", { headerId: h.id });
        }
        resolvedExtensions.push({ extension: ext as ResolvedExt["extension"], headerSecrets });
      }
    }
  }

  const tools = await buildToolset({
    user: ctx.user.id,
    threadId: ctx.thread.id,
    threadDocumentIds: ctx.threadDocumentIds,
    personaDocumentIds: ctx.personaDocumentIds,
    defaultTools: ctx.defaultTools ?? {},
    extensions: resolvedExtensions,
    subAgentIds: ctx.thread.subAgentIds,
    depth: 0,
  });

  // Resolve provider-native parts (model, built-in tools, providerOptions)
  // through the provider seam so Anthropic / future providers slot in
  // without touching this route handler (architect2 SEV-2 B10).
  const resolved = resolveProvider({
    modelId: payload.selectedModel ?? ctx.thread.selectedModel ?? DEFAULT_MODEL,
    thread: {
      id: ctx.thread.id,
      codeInterpreterContainerId: ctx.thread.codeInterpreterContainerId,
    },
    toggles: effectiveTools,
    reasoning: {
      supported: modelConfig.supportsReasoning,
      effort: effectiveReasoningEffort,
    },
  });
  logInfo("/api/chat builtInTools", {
    keys: Object.keys(resolved.builtInTools),
    effectiveTools,
  });

  // Cast through `ToolSet` (the AI SDK's public interface) rather than
  // through streamText's parameter type. ToolSet is structurally a
  // Record<string, Tool>; both `tools` (custom registry) and
  // `resolved.builtInTools` (provider-native) satisfy it.
  const allTools = {
    ...tools,
    ...resolved.builtInTools,
  } as ToolSet;

  // Captured by `onError` so the failure cause can flow into onFinish's
  // sentinel row — without this, every provider failure renders as the
  // generic "no content" message, masking real causes (content filter,
  // unsupported tool, auth/quota) from the user.
  let lastStreamError: { message: string; name?: string } | undefined;
  // Set true when onFinish runs. If streamText fails early (e.g. asset
  // download rejected with AI_DownloadError before any chunk lands),
  // onFinish never fires — and without a fallback the thread is left with
  // just a user row, so the UI polls for 60 s and shows "no reply" even
  // though we know what went wrong. The consumeStream catch below uses
  // this flag to write a sentinel as a last-resort.
  let onFinishRan = false;

  // streamText's onAbort fires when the abort signal trips, but the
  // event it hands us only contains finished `steps` — mid-step text
  // deltas live nowhere addressable after abort. Accumulate them via
  // onChunk so the stop endpoint can persist what the user already saw.
  let accumulatedText = "";
  let accumulatedReasoning = "";

  // Register the publisher BEFORE streamText so we can pass abortSignal
  // and so a fast first-chunk doesn't race a late subscriber. The
  // returned AbortController is what POST /api/chat/[id]/stop calls
  // abort() on — req.signal is deliberately NOT forwarded so that a
  // browser tab-switch does not cancel the run (stream-publisher.ts
  // keeps replaying for the next subscriber).
  const { abortController, publish } = startPublisher(ctx.thread.id);

  const result = streamText({
    model: resolved.model,
    system,
    messages: await convertToModelMessages(ctx.history),
    tools: allTools,
    stopWhen: stepCountIs(8),
    abortSignal: abortController.signal,
    experimental_transform: (() => {
      // Shared map populated by the code-interpreter rewriter when it
      // persists a data: URL → blob ref; the sandbox text-delta transform
      // consumes it to substitute matching data: URLs the model echoes
      // in its prose.
      const dataUrlToBlobRef = new Map<string, string>();
      return [
        createImageGenerationStreamRewriter(ctx.thread.id),
        createCodeInterpreterStreamRewriter(ctx.thread.id, dataUrlToBlobRef),
        createSandboxUrlTransform(ctx.thread.id, dataUrlToBlobRef),
      ];
    })(),
    providerOptions: resolved.providerOptions,
    onError: ({ error }) => {
      // `Error` objects have non-enumerable `.message` and `.stack`, so
      // logging `{ error }` straight loses everything when the logger
      // JSON-stringifies. Spread the readable fields explicitly so the
      // failure cause actually lands in the log instead of `{}`.
      const e = error as { message?: string; name?: string; stack?: string; cause?: unknown };
      const message = e?.message ?? String(error);
      lastStreamError = { message, name: e?.name };
      logError("/api/chat streamText error", {
        threadId: ctx.thread.id,
        turnId: ctx.turnId,
        message,
        name: e?.name,
        stack: e?.stack,
        cause: e?.cause,
      });
    },
    onChunk: ({ chunk }) => {
      if (chunk.type === "text-delta") accumulatedText += chunk.text;
      else if (chunk.type === "reasoning-delta") accumulatedReasoning += chunk.text;
    },
    onAbort: async ({ steps }) => {
      logWarn("/api/chat streamText onAbort fired", {
        threadId: ctx.thread.id,
        textLen: accumulatedText.length,
        stepCount: steps.length,
      });
      // Persist whatever the user already saw. Synthesize an OnFinishEvent
      // shape from the accumulated chunks + any completed-step toolResults
      // so we can reuse the existing persist path. onFinish does NOT fire
      // after an abort, so this is the only place to write the partial.
      onFinishRan = true;
      try {
        const aggregatedToolResults = steps.flatMap((s) => s.toolResults);
        await persistAssistantFromFinishEvent({
          threadId: ctx.thread.id,
          turnId: ctx.turnId,
          event: {
            text: accumulatedText,
            reasoningText: accumulatedReasoning || undefined,
            toolResults: aggregatedToolResults,
            finishReason: "other",
            totalUsage: {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
            },
            steps,
          } as unknown as Parameters<typeof persistAssistantFromFinishEvent>[0]["event"],
          modelConfig,
          fallbackInfo: fallbackInfo.fellBack ? fallbackInfo : undefined,
        });
      } catch (err) {
        logError("/api/chat onAbort persist failed", {
          threadId: ctx.thread.id,
          turnId: ctx.turnId,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        unregisterPublisher(ctx.thread.id);
      }
    },
    // Persist from streamText.onFinish so the assistant turn lands in
    // Cosmos when the LLM finishes — not when the response stream closes
    // (which happens early on client disconnect and would persist a
    // partial message).
    onFinish: async (event) => {
      logInfo("/api/chat streamText.onFinish fired", {
        threadId: ctx.thread.id,
        finishReason: event.finishReason,
        textLen: event.text.length,
        toolResultCount: event.toolResults.length,
        toolResultNames: event.toolResults.map((r) => r.toolName),
      });
      // When finishReason === "error", `onError` does NOT always fire (the
      // AI SDK distinguishes thrown stream errors from provider-reported
      // error finish reasons). Mine `event.warnings` / `event.providerMetadata`
      // for the cause so the sentinel row in Cosmos isn't a generic
      // "no content" placeholder.
      if (event.finishReason === "error" && !lastStreamError) {
        const synthesized = reconstructStreamError(event);
        if (synthesized) {
          lastStreamError = synthesized;
          logError("/api/chat onFinish reconstructed streamError from event", {
            threadId: ctx.thread.id,
            turnId: ctx.turnId,
            message: synthesized.message,
          });
        }
      }
      onFinishRan = true;
      try {
        await persistAssistantFromFinishEvent({
          threadId: ctx.thread.id,
          turnId: ctx.turnId,
          event,
          modelConfig,
          fallbackInfo: fallbackInfo.fellBack ? fallbackInfo : undefined,
          streamError: lastStreamError,
        });
        // Generate a thread title from the first user message. ctx.history
        // has just the user message we appended in loadThreadContext when
        // this is the first turn (length === 1). Fire-and-forget — title
        // is cosmetic; failures shouldn't block the assistant reply.
        if (ctx.history.length === 1) {
          UpdateChatTitle(ctx.thread.id, payload.message).catch((err) => {
            logError("/api/chat UpdateChatTitle failed", {
              threadId: ctx.thread.id,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
      } catch (err) {
        // Persist failed (Cosmos transient, etc). One retry, then if still
        // broken write a sentinel row so the user sees *something* instead
        // of an orphan user row + polling forever (architect2 SEV-1 B1).
        logError("/api/chat persistAssistantFromFinishEvent failed, retrying", {
          threadId: ctx.thread.id,
          turnId: ctx.turnId,
          error: err instanceof Error ? err.message : String(err),
        });
        try {
          await persistAssistantFromFinishEvent({
            threadId: ctx.thread.id,
            turnId: ctx.turnId,
            event,
            modelConfig,
            fallbackInfo: fallbackInfo.fellBack ? fallbackInfo : undefined,
            streamError: lastStreamError,
          });
        } catch (retryErr) {
          logError("/api/chat persistAssistantFromFinishEvent retry failed", {
            threadId: ctx.thread.id,
            turnId: ctx.turnId,
            error:
              retryErr instanceof Error ? retryErr.message : String(retryErr),
          });
          // Last-resort sentinel — at least an assistant row exists for
          // this turn so polling stops and history doesn't show a hanging
          // user row.
          try {
            const { UpsertChatMessage } = await import(
              "@/features/chat-page/chat-services/chat-message-service"
            );
            const { userHashedId } = await import("@/features/auth-page/helpers");
            await UpsertChatMessage({
              id: `sentinel-${ctx.turnId}`,
              createdAt: new Date(),
              isDeleted: false,
              threadId: ctx.thread.id,
              userId: await userHashedId(),
              name: "system",
              role: "assistant",
              content:
                "_The generation completed but the result could not be saved (Cosmos write failed twice). Please resend your message._",
              type: "CHAT_MESSAGE",
              turnId: ctx.turnId,
            });
          } catch (sentinelErr) {
            // Even the sentinel write failed. The 60-second polling cap
            // in chat-page.tsx will at least surface "no reply arrived"
            // to the user. Log loudly so App Insights captures the
            // triple-failure for the on-call to find.
            logError("/api/chat sentinel write failed (triple-failure)", {
              threadId: ctx.thread.id,
              turnId: ctx.turnId,
              error:
                sentinelErr instanceof Error
                  ? sentinelErr.message
                  : String(sentinelErr),
            });
          }
        }
      } finally {
        // Drop the publisher entry; nothing useful to resume after the
        // stream is fully persisted to Cosmos.
        unregisterPublisher(ctx.thread.id);
      }
    },
  });

  // Drain the stream so the LLM call runs to completion even when the
  // browser disconnects (user navigates mid-stream). The promise returned
  // is PromiseLike — wrap in Promise.resolve to attach error handling.
  //
  // After the stream settles, check whether onFinish actually ran. If the
  // stream errored BEFORE any chunk (e.g. AI_DownloadError on history
  // assets, model deployment 404, auth refused at the first hop), the AI
  // SDK fires onError but skips onFinish — so no sentinel is written and
  // the UI polls for 60 s on an orphaned user row. Write a sentinel here
  // as a last resort so the chat doesn't appear hung.
  Promise.resolve(result.consumeStream())
    .catch(async (err) => {
      logError("/api/chat consumeStream rejected", {
        threadId: ctx.thread.id,
        turnId: ctx.turnId,
        error: err instanceof Error ? err.message : String(err),
      });
    })
    .finally(async () => {
      unregisterPublisher(ctx.thread.id);
      if (onFinishRan) return;
      // When the user clicked stop, consumeStream settles (rejected
      // promise from the abort) BEFORE streamText's onAbort callback
      // runs — so onFinishRan is still false here. Don't write a
      // sentinel in that case; onAbort owns persistence on the abort
      // path. Without this guard the sentinel races onAbort's partial
      // and overwrites the tokens the user already saw.
      if (abortController.signal.aborted) return;
      logWarn(
        "/api/chat onFinish never fired — writing early-error sentinel",
        {
          threadId: ctx.thread.id,
          turnId: ctx.turnId,
          lastStreamError,
        },
      );
      try {
        const [{ UpsertChatMessage }, { userHashedId }, { friendlyErrorMessage }] =
          await Promise.all([
            import("@/features/chat-page/chat-services/chat-message-service"),
            import("@/features/auth-page/helpers"),
            import(
              "@/features/chat-page/chat-services/chat-api/persist-assistant"
            ),
          ]);
        const sentinelText = lastStreamError
          ? friendlyErrorMessage(lastStreamError)
          : "_⚠️ Something went wrong generating the reply. Please try again, or start a new chat if it keeps happening._";
        await UpsertChatMessage({
          id: `sentinel-${ctx.turnId}`,
          createdAt: new Date(),
          isDeleted: false,
          threadId: ctx.thread.id,
          userId: await userHashedId(),
          name: "system",
          role: "assistant",
          content: sentinelText,
          type: "CHAT_MESSAGE",
          turnId: ctx.turnId,
        });
      } catch (sentinelErr) {
        logError(
          "/api/chat early-error sentinel write failed",
          {
            threadId: ctx.thread.id,
            turnId: ctx.turnId,
            error:
              sentinelErr instanceof Error
                ? sentinelErr.message
                : String(sentinelErr),
          },
        );
      }
    });

  // Build the framed UI-message-stream HTTP response, then tee the body:
  // one branch is sent to the POST caller, the other feeds the per-thread
  // publisher so reattach (GET /api/chat/[id]/stream) can replay the
  // buffered prefix and forward live chunks. tee() backpressures both
  // consumers on the slower one — the publisher drains eagerly so the
  // POST stream isn't held back when no GET is attached.
  const framedResponse = result.toUIMessageStreamResponse({
    originalMessages: ctx.history,
    generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }),
    onError: (err) => (err instanceof Error ? err.message : String(err)),
  });
  if (!framedResponse.body) {
    unregisterPublisher(ctx.thread.id);
    return framedResponse;
  }
  // `blob://` references flow through the wire unchanged. The client
  // resolves them at render time (tool-part-view / chat-image-display).
  const [responseBranch, publisherBranch] = framedResponse.body.tee();
  publish(publisherBranch);

  return new Response(responseBranch, {
    status: framedResponse.status,
    statusText: framedResponse.statusText,
    headers: framedResponse.headers,
  });
}
