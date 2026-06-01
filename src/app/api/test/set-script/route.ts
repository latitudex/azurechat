/**
 * /api/test/set-script — test-only script-injection endpoint.
 *
 * Gated on AZURECHAT_TEST_BACKEND=memory. Updates the in-process env
 * var that the fake AI provider (e2e-fakes/azure-provider.ts) reads on
 * each LLM call to decide what to stream back. Lets Playwright specs
 * script per-test scenarios (text / reasoning / tool-call / error)
 * without the page.route() interception that died with chat-store.tsx's
 * custom SSE envelope.
 *
 * Returns 404 in production-like configs so the endpoint cannot leak.
 */
import { NextRequest } from "next/server";
import { isE2eFakesAllowed } from "@/features/common/services/e2e-fakes-gate";

export async function POST(req: NextRequest) {
  if (!isE2eFakesAllowed()) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const body = await req.text();
    // Validate that it's JSON — the fake provider does its own
    // structural validation when consuming, but rejecting non-JSON here
    // prevents accidental setting of garbage env values.
    JSON.parse(body);
    process.env.AZURECHAT_E2E_SCRIPT = body;
    return new Response("ok", { status: 200 });
  } catch (err) {
    return new Response(
      `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      { status: 400 },
    );
  }
}

export async function DELETE() {
  if (!isE2eFakesAllowed()) {
    return new Response("Not found", { status: 404 });
  }
  delete process.env.AZURECHAT_E2E_SCRIPT;
  return new Response("ok", { status: 200 });
}
