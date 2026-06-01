/**
 * /api/test/reset-thread — test-only thread reset.
 *
 * Used by Playwright `beforeEach` to clear accumulated messages from
 * `/chat/temporary` (or any thread) so order-dependent state from
 * prior tests doesn't leak into the next. Gated identically to
 * /api/test/set-script — must NEVER ship as a live production
 * endpoint.
 */

import { NextRequest } from "next/server";
import { ResetChatThread } from "@/features/chat-page/chat-services/chat-thread-service";
import { isE2eFakesAllowed } from "@/features/common/services/e2e-fakes-gate";

export async function POST(req: NextRequest) {
  if (!isE2eFakesAllowed()) {
    return new Response("Not found", { status: 404 });
  }
  const url = new URL(req.url);
  const threadId = url.searchParams.get("threadId");
  if (!threadId) {
    return new Response("Missing threadId query parameter", { status: 400 });
  }
  try {
    const result = await ResetChatThread(threadId);
    if (result.status !== "OK") {
      return new Response(
        `ResetChatThread failed: ${result.errors[0]?.message ?? "unknown"}`,
        { status: 500 },
      );
    }
    return new Response("ok", { status: 200 });
  } catch (err) {
    return new Response(
      `Reset failed: ${err instanceof Error ? err.message : String(err)}`,
      { status: 500 },
    );
  }
}
