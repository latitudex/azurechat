/**
 * /api/test/new-thread — test-only fresh-thread factory.
 *
 * Each Playwright test that needs an isolated thread calls this in
 * `beforeEach`; using the shared `/chat/temporary` causes order-
 * dependent state leaks (see task #38). Gated identically to
 * /api/test/set-script.
 */

import { CreateChatThread } from "@/features/chat-page/chat-services/chat-thread-service";
import { isE2eFakesAllowed } from "@/features/common/services/e2e-fakes-gate";

export async function POST() {
  if (!isE2eFakesAllowed()) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const result = await CreateChatThread({ temporary: false });
    if (result.status !== "OK") {
      return new Response(
        `CreateChatThread failed: ${result.errors[0]?.message ?? "unknown"}`,
        { status: 500 },
      );
    }
    return new Response(
      JSON.stringify({ id: result.response.id, url: `/chat/${result.response.id}` }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  } catch (err) {
    return new Response(
      `Create failed: ${err instanceof Error ? err.message : String(err)}`,
      { status: 500 },
    );
  }
}
