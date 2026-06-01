"use server";
import "server-only";

/**
 * model-selection.ts
 *
 * Resolves the effective model + limits for a chat request.
 * Extracted from chat-api-response.ts (CheckLimits + fallback block).
 */

import { userHashedId } from "@/features/auth-page/helpers";
import { logError, logInfo } from "@/features/common/services/logger";
import { CheckLimits } from "@/features/common/services/usage-service";
import {
  ChatModel,
  ChatThreadModel,
  DEFAULT_MODEL,
  MODEL_CONFIGS,
  ModelConfig,
  ReasoningEffort,
} from "../models";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FallbackInfo {
  fellBack: true;
  originalModel: ChatModel;
  fallbackModel: ChatModel;
  message: string;
  limitType: "tokens" | "cost";
  currentUsage: number;
  limit: number;
}

export interface NoFallback {
  fellBack: false;
}

export type FallbackResult = FallbackInfo | NoFallback;

export interface ModelSelectionResult {
  modelDeployment: string;
  modelConfig: ModelConfig;
  fallbackInfo: FallbackResult;
  selectedModel: ChatModel;
  effectiveReasoningEffort?: ReasoningEffort;
}

// ---------------------------------------------------------------------------
// resolveModelAndLimits
// ---------------------------------------------------------------------------

/**
 * Determines the effective model to use for a request:
 * 1. Picks the model from the payload or thread (falling back to DEFAULT_MODEL).
 * 2. Calls CheckLimits for the resolved user; if the daily limit is exceeded
 *    and a fallback model is configured, switches to the fallback.
 * 3. Returns the deployment name, full ModelConfig, fallback metadata, and
 *    the effective reasoning effort.
 *
 * Throws if no deploymentName is configured for the selected model.
 */
export async function resolveModelAndLimits(
  payload: {
    selectedModel?: ChatModel;
    reasoningEffort?: ReasoningEffort;
  },
  thread: ChatThreadModel
): Promise<ModelSelectionResult> {
  let selectedModel: ChatModel =
    payload.selectedModel ?? thread.selectedModel ?? DEFAULT_MODEL;
  let modelConfig = MODEL_CONFIGS[selectedModel];

  const reasoningEffort: ReasoningEffort =
    payload.reasoningEffort ?? modelConfig?.defaultReasoningEffort ?? "low";

  // Check usage limits and apply fallback if needed
  let fallbackInfo: FallbackResult = { fellBack: false };
  try {
    const userId = await userHashedId();
    const limitCheck = await CheckLimits(userId, selectedModel);
    if (limitCheck.exceeded && limitCheck.fallbackModel) {
      const fallbackConfig = MODEL_CONFIGS[limitCheck.fallbackModel];
      if (fallbackConfig?.deploymentName) {
        fallbackInfo = {
          fellBack: true,
          originalModel: selectedModel,
          fallbackModel: limitCheck.fallbackModel,
          message: `Daily ${limitCheck.limitType} limit reached for ${selectedModel}. Using ${limitCheck.fallbackModel} instead.`,
          limitType: limitCheck.limitType!,
          currentUsage: limitCheck.currentUsage!,
          limit: limitCheck.limit!,
        } satisfies FallbackInfo;
        logInfo("Limit exceeded, falling back", {
          originalModel: selectedModel,
          fallbackModel: limitCheck.fallbackModel,
        });
        selectedModel = limitCheck.fallbackModel;
        modelConfig = fallbackConfig;
      }
    }
  } catch (err) {
    logError("Failed to check limits", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (!modelConfig?.deploymentName) {
    logError("Missing deployment configuration", {
      selectedModel,
      availableModels: Object.keys(MODEL_CONFIGS),
    });
    throw Object.assign(
      new Error(
        `Missing deployment configuration for model ${selectedModel}`
      ),
      { status: 500 }
    );
  }

  return {
    modelDeployment: modelConfig.deploymentName,
    modelConfig,
    fallbackInfo,
    selectedModel,
    effectiveReasoningEffort: reasoningEffort,
  };
}
