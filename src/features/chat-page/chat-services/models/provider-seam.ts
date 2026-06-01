/**
 * provider-seam.ts
 *
 * Generic provider abstraction. Resolves a model id (any provider) into
 * everything `streamText` needs to actually invoke that provider:
 *
 *   - `model`              the LanguageModelV3 instance
 *   - `builtInTools(...)`  provider-native server-side tools merged into
 *                          the user's effective-toggles set
 *   - `providerOptions(...)` per-provider options block (reasoning,
 *                          prompt-cache key, anything else)
 *
 * Today only Azure (gpt-5.* via @ai-sdk/azure / Responses API) is wired up;
 * the seam keeps route.ts agnostic so an Anthropic implementation slots in
 * without touching the route handler — just register a new entry here and
 * add models to MODEL_CONFIGS with `provider: "anthropic"`.
 *
 * What goes where on addition of a new provider:
 *   1. Add `provider: "anthropic"` (or similar) to the model's ModelConfig.
 *   2. Add a branch below resolving that provider's LanguageModelV3 +
 *      built-in tools + providerOptions shape.
 *   3. If Anthropic exposes tools we want to surface (e.g. their server-
 *      side bash tool), wire those into builtInTools branch. Otherwise
 *      Anthropic returns an empty toolset and only custom tools (our RAG,
 *      sub-agents, extension tools) flow through.
 *
 * Architect2 SEV-2 B10: this kills the "hardcoded azure.tools.* and
 * providerOptions.openai.* in route.ts" coupling.
 */

import type { LanguageModelV3, JSONValue } from "@ai-sdk/provider";
import { azure } from "@ai-sdk/azure";
import { resolveAzureModel } from "./provider";
import {
  MODEL_CONFIGS,
  type ChatModel,
  type ReasoningEffort,
  type ModelConfig,
} from "../models";
import type { ChatThreadModel } from "../models";

/**
 * Effective tool toggles for this turn — merged from per-request payload +
 * thread defaults by the route handler before this seam is called.
 */
export interface BuiltInToggles {
  codeInterpreter: boolean;
  imageGeneration: boolean;
  webSearch: boolean;
}

export interface ResolvedProvider {
  model: LanguageModelV3;
  /**
   * Map of provider-native tools keyed by stable tool-name (used as part
   * type by the AI SDK stream). Merged with custom tools by the route.
   */
  builtInTools: Record<string, unknown>;
  /**
   * Object passed verbatim into streamText({ providerOptions }).
   * Provider-specific keys; AI SDK ignores unknown providers' keys.
   * Values must be JSON-serialisable per AI SDK's SharedV3ProviderOptions.
   */
  providerOptions: Record<string, Record<string, JSONValue>>;
}

export interface ResolveProviderArgs {
  modelId: ChatModel;
  thread: Pick<ChatThreadModel, "id" | "codeInterpreterContainerId">;
  toggles: BuiltInToggles;
  reasoning: {
    supported: boolean;
    effort: ReasoningEffort | undefined;
  };
  /**
   * Files the user attached for code_interpreter this turn (OpenAI file
   * IDs from `/api/code-interpreter/upload`). When no container is
   * reusable, we ask Azure to spin up a fresh container with these
   * files attached via `container: { fileIds }` — without this the
   * container starts empty and `read_file()` returns "file not found".
   *
   * The caller is responsible for invalidating a stale container before
   * calling: if `codeInterpreterContainerId` is set we trust it covers
   * these file IDs. Mismatch resolution lives in route.ts via the
   * persisted `codeInterpreterFileIdsSignature`.
   */
  codeInterpreterFileIds?: string[];
}

/**
 * Stable signature for a set of OpenAI file IDs. Used by the route to
 * detect when a thread's attached-file set changed between turns so the
 * persisted container_id can be invalidated and Azure asked to create a
 * fresh container with the new file set. Sort + dedupe so reorder /
 * duplicates don't cause spurious invalidations.
 */
export function getFileIdsSignature(fileIds: string[] | undefined): string {
  if (!fileIds || fileIds.length === 0) return "";
  return [...new Set(fileIds)].sort().join(",");
}

/**
 * Build a ResolvedProvider from a ChatModel id + per-turn context.
 * Throws if the model id is unknown or its provider has no factory wired.
 */
export function resolveProvider(args: ResolveProviderArgs): ResolvedProvider {
  const config: ModelConfig | undefined = MODEL_CONFIGS[args.modelId];
  if (!config) {
    throw new Error(`resolveProvider: unknown modelId "${args.modelId}"`);
  }

  // ModelConfig.provider is optional today (Azure-only). Treat absence as
  // "azure" to keep existing rows working without backfill.
  const providerTag = (config as { provider?: "azure" | "anthropic" }).provider ?? "azure";

  switch (providerTag) {
    case "azure":
      return resolveAzureBackedProvider(args);
    case "anthropic":
      // Reserved for the follow-up Anthropic PR. Throw a descriptive
      // error rather than silently fall back, so the missing wiring is
      // surfaced when the user first picks an Anthropic model.
      throw new Error(
        `resolveProvider: model "${args.modelId}" is provider="anthropic", ` +
          `but the Anthropic seam is not yet wired. Install @ai-sdk/anthropic ` +
          `and implement the anthropic branch in provider-seam.ts.`
      );
    default:
      throw new Error(
        `resolveProvider: unhandled provider "${providerTag}" for model "${args.modelId}"`
      );
  }
}

function resolveAzureBackedProvider(args: ResolveProviderArgs): ResolvedProvider {
  const model = resolveAzureModel(args.modelId);

  // Built-in tools that Azure runs server-side (Responses API).
  // codeInterpreter: container reuse OR fileIds-bootstrap, see below.
  // imageGeneration & webSearchPreview: parameterless.
  const builtInTools: Record<string, unknown> = {};
  if (args.toggles.codeInterpreter) {
    const containerId = args.thread.codeInterpreterContainerId;
    const fileIds = args.codeInterpreterFileIds ?? [];
    // Three shapes the @ai-sdk/azure codeInterpreter accepts:
    //   - container: "<id>"           → reuse the existing container; files
    //                                    are already attached on Azure's side
    //   - container: { fileIds: [..]} → ask Azure to mint a new container
    //                                    and attach these uploaded files
    //   - {}                          → empty container, no files
    // We pick reuse first because it's stable across turns AND preserves
    // any working-directory state the interpreter built up (downloaded
    // CSVs, generated images, etc.). Route invalidates this id when the
    // file signature changes, so a non-empty containerId here implies
    // the files are still current.
    let codeInterpreterArgs: { container?: string | { fileIds?: string[] } } = {};
    if (containerId) {
      codeInterpreterArgs = { container: containerId };
    } else if (fileIds.length > 0) {
      codeInterpreterArgs = { container: { fileIds } };
    }
    builtInTools["code_interpreter"] = azure.tools.codeInterpreter(codeInterpreterArgs);
  }
  if (args.toggles.imageGeneration) {
    // partialImages: 0 tells Azure NOT to stream partial-image previews.
    // Without this, Azure emits a partial as a `tool-result` chunk with
    // `preliminary: true` followed by the final — the duplicate
    // `tool-output-available` UI event throws the model off and it ends
    // the turn with no text response. See the matching `preliminary`
    // filter in image-generation-stream-rewriter.ts.
    builtInTools["image_generation"] = azure.tools.imageGeneration({
      partialImages: 0,
    });
  }
  if (args.toggles.webSearch) {
    builtInTools["web_search_preview"] = azure.tools.webSearchPreview({});
  }

  // Provider options. The @ai-sdk/azure model speaks OpenAI Responses API
  // under the hood so the providerOptions namespace is "openai", not
  // "azure" — verified from @ai-sdk/openai/internal types.
  const openaiOptions: Record<string, JSONValue> = {
    promptCacheKey: args.thread.id,
    store: false,
  };
  if (args.reasoning.supported && args.reasoning.effort) {
    openaiOptions.reasoningEffort = args.reasoning.effort;
    openaiOptions.reasoningSummary = "auto";
    openaiOptions.include = ["reasoning.encrypted_content"];
  }

  return {
    model,
    builtInTools,
    providerOptions: { openai: openaiOptions },
  };
}
