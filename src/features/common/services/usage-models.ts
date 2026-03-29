export const USER_USAGE_ATTRIBUTE = "USER_USAGE";

export interface ModelUsageBreakdown {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
  requestCount: number;
}

export interface UserUsageModel {
  id: string;
  userId: string;
  date: string;
  type: typeof USER_USAGE_ATTRIBUTE;
  models: Record<string, ModelUsageBreakdown>;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalCostUsd: number;
}

import type { ChatModel } from "@/features/chat-page/chat-services/models";

export interface LimitCheckResult {
  exceeded: boolean;
  limitType?: "tokens" | "cost";
  currentUsage?: number;
  limit?: number;
  fallbackModel?: ChatModel;
}
