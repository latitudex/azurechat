/**
 * POST /api/chat/[id]/stop
 *
 * Explicit-stop endpoint for the AI SDK v6 resumable-streams pattern.
 * Aborts the server-side streamText call for `threadId`. The existing
 * onAbort + onFinish chain in /api/chat persists whatever tokens the
 * model produced before abort (or writes a sentinel on triple-failure),
 * so the client does NOT need to send a partial assistant message back.
 *
 * Returns 200 in all success cases (including "nothing to abort") so the
 * stop button is idempotent — a second click while the cancellation is
 * unwinding is a no-op, not an error.
 */

import "server-only";
import { getCurrentUser } from "@/features/auth-page/helpers";
import { FindChatThreadForCurrentUser } from "@/features/chat-page/chat-services/chat-thread-service";
import { abortPublisher } from "@/features/chat-page/chat-services/chat-api/stream-publisher";
import { enforceSameOriginRequest } from "@/features/chat-page/chat-services/chat-api/same-origin";
import { logInfo, logWarn } from "@/features/common/services/logger";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originCheck = enforceSameOriginRequest(req);
  if (originCheck) return originCheck;

  try {
    await getCurrentUser();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id: threadId } = await params;

  const threadResp = await FindChatThreadForCurrentUser(threadId);
  if (threadResp.status !== "OK") {
    logWarn("/api/chat/[id]/stop: thread not accessible", {
      threadId,
      status: threadResp.status,
    });
    return new Response("Forbidden", { status: 403 });
  }

  const aborted = abortPublisher(threadId);
  logInfo("/api/chat/[id]/stop processed", { threadId, aborted });
  return Response.json({ success: true, aborted });
}
