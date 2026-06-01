/**
 * GET /api/chat/[id]/stream
 *
 * Reattach endpoint for the AI SDK v6 resumable-streams pattern. The
 * client's useChat({ resume: true }) calls this on mount via the
 * transport's prepareReconnectToStreamRequest. We answer from the
 * per-replica in-memory publisher (see stream-publisher.ts).
 *
 * Returns:
 *   200 + UI_MESSAGE_STREAM_HEADERS — live stream replayed-from-buffer
 *                                     then forwarded until upstream closes
 *   204                             — no active publisher on this replica
 *                                     (client falls back to the persisted
 *                                     assistant row + polling)
 *   401                             — caller is not authenticated
 *   403                             — cross-origin or thread not owned by caller
 */

import "server-only";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import { getCurrentUser } from "@/features/auth-page/helpers";
import { FindChatThreadForCurrentUser } from "@/features/chat-page/chat-services/chat-thread-service";
import { subscribeStream } from "@/features/chat-page/chat-services/chat-api/stream-publisher";
import { logWarn } from "@/features/common/services/logger";
import { enforceSameOriginRequest } from "@/features/chat-page/chat-services/chat-api/same-origin";

export async function GET(
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
    // The thread either doesn't exist or doesn't belong to this user.
    // Don't leak which — 403 in both cases.
    logWarn("/api/chat/[id]/stream: thread not accessible", {
      threadId,
      status: threadResp.status,
    });
    return new Response("Forbidden", { status: 403 });
  }

  const stream = subscribeStream(threadId);
  if (!stream) {
    // No active publisher on this replica. The SDK treats 204 as
    // "nothing to resume, render initial messages and stop polling".
    return new Response(null, { status: 204 });
  }

  return new Response(stream, {
    status: 200,
    headers: UI_MESSAGE_STREAM_HEADERS,
  });
}
