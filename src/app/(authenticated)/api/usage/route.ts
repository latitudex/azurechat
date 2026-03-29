import { NextResponse } from "next/server";
import { GetDailyUsage, GetWeeklyUsage } from "@/features/common/services/usage-service";
import { logError } from "@/features/common/services/logger";

export async function GET() {
  try {
    const [daily, weekly] = await Promise.all([
      GetDailyUsage(),
      GetWeeklyUsage(),
    ]);

    const weeklyTotals = weekly.reduce(
      (acc, day) => ({
        totalInputTokens: acc.totalInputTokens + day.totalInputTokens,
        totalOutputTokens: acc.totalOutputTokens + day.totalOutputTokens,
        totalCostUsd: acc.totalCostUsd + day.totalCostUsd,
      }),
      { totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0 }
    );

    return NextResponse.json({
      daily: {
        totalTokens: daily.totalInputTokens + daily.totalOutputTokens,
        totalCostUsd: daily.totalCostUsd,
        models: daily.models,
      },
      weekly: {
        totalTokens: weeklyTotals.totalInputTokens + weeklyTotals.totalOutputTokens,
        totalCostUsd: weeklyTotals.totalCostUsd,
      },
    });
  } catch (error) {
    logError("Error getting usage", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to get usage" },
      { status: 500 }
    );
  }
}
