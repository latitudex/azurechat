import "server-only";

/**
 * stream-publisher.ts
 *
 * Per-replica in-memory publisher of in-flight UI-message streams, keyed
 * by threadId. Implements the AI SDK v6 "resumable streams" pattern
 * (https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams) without the
 * Redis dependency — supports reattach within a single replica only.
 *
 * Capabilities (vs the previous turn-registry):
 *   - Keyed by threadId, not turnId — clients can reattach knowing only
 *     the chat ID (which they always know on mount).
 *   - Multi-subscriber: the original POST response and one-or-more GET
 *     reattach calls all receive the full byte sequence. Late subscribers
 *     replay the buffered prefix, then forward live chunks.
 *   - Owns an AbortController so /api/chat/[id]/stop can cancel the
 *     server-side streamText call (the POST handler does NOT forward
 *     req.signal because we want browser-disconnect to keep the stream
 *     alive for reattach).
 *
 * Limitations:
 *   - Single replica. With replicaCount > 1 a client that hits a different
 *     replica gets 204 from GET and falls back to the persisted-message
 *     poll (chat-page.tsx).
 *   - Process-local. Recycle drops in-flight streams; onFinish/sentinel
 *     paths in /api/chat keep persistence whole.
 *   - Buffer is unbounded for the duration of one turn (capped by the
 *     TTL sweep below). A pathological tool-call loop emitting megabytes
 *     of tokens would grow this until onFinish. The 8-step cap in
 *     route.ts (stepCountIs(8)) bounds this in practice.
 */

/**
 * TTL for an in-memory publisher entry. A publisher whose onFinish never
 * fires within this window is evicted on the next pruneStale pass —
 * bounded so a recycled or wedged process can't leak ReadableStream
 * references and listener sets indefinitely.
 */
export const PUBLISHER_TTL_MS = 10 * 60 * 1000;

type ChunkListener = (chunk: Uint8Array) => void;
type DoneListener = () => void;

interface Publisher {
  threadId: string;
  abortController: AbortController;
  /** All chunks observed so far — replayed verbatim to late subscribers. */
  buffer: Uint8Array[];
  /** True once the upstream stream has closed (clean or aborted). */
  done: boolean;
  chunkListeners: Set<ChunkListener>;
  doneListeners: Set<DoneListener>;
  registeredAt: number;
}

const publishers = new Map<string, Publisher>();

/**
 * Start publishing for `threadId`. The caller must `tee()` the framed
 * response body and pass the publisher branch here — `publish()` drains it
 * into the in-memory buffer and fans out to subscribers.
 *
 * Returns the AbortController that the stop endpoint should call abort()
 * on to cancel the underlying streamText. The same signal must be passed
 * to streamText({ abortSignal }).
 */
export function startPublisher(threadId: string): {
  abortController: AbortController;
  publish: (source: ReadableStream<Uint8Array>) => void;
} {
  pruneStale();

  // Defensive: if a previous publisher for this thread is still around
  // (a stuck stream that never reached onFinish), evict it so the new
  // submission wins.
  const existing = publishers.get(threadId);
  if (existing && !existing.done) {
    closePublisher(existing);
  }

  const abortController = new AbortController();
  const publisher: Publisher = {
    threadId,
    abortController,
    buffer: [],
    done: false,
    chunkListeners: new Set(),
    doneListeners: new Set(),
    registeredAt: Date.now(),
  };
  publishers.set(threadId, publisher);

  const publish = (source: ReadableStream<Uint8Array>): void => {
    void drain(publisher, source);
  };

  return { abortController, publish };
}

/**
 * Subscribe to the live stream for `threadId`. Returns a new
 * ReadableStream that first replays the buffered prefix, then forwards
 * live chunks until the publisher closes. Returns null when no publisher
 * is registered for `threadId` on this replica — the GET handler
 * translates that into 204.
 */
export function subscribeStream(
  threadId: string,
): ReadableStream<Uint8Array> | null {
  pruneStale();
  const publisher = publishers.get(threadId);
  if (!publisher) return null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of publisher.buffer) {
        controller.enqueue(chunk);
      }
      if (publisher.done) {
        controller.close();
        return;
      }
      const onChunk: ChunkListener = (chunk) => {
        try {
          controller.enqueue(chunk);
        } catch {
          // Subscriber stream was cancelled mid-fanout; detach quietly.
          publisher.chunkListeners.delete(onChunk);
          publisher.doneListeners.delete(onDone);
        }
      };
      const onDone: DoneListener = () => {
        try {
          controller.close();
        } catch {
          // Already cancelled — ignore.
        }
        publisher.chunkListeners.delete(onChunk);
        publisher.doneListeners.delete(onDone);
      };
      publisher.chunkListeners.add(onChunk);
      publisher.doneListeners.add(onDone);
    },
    cancel() {
      // Subscriber walked away; the upstream stream keeps publishing for
      // other subscribers (and so onFinish still persists the turn).
    },
  });
}

/**
 * Trigger an abort on the publisher for `threadId` (if any). The
 * AbortController.signal was passed to streamText, so this cancels the
 * upstream LLM call. Subscribers see the stream close once the upstream
 * settles. Returns true if a publisher was found and aborted.
 */
export function abortPublisher(threadId: string): boolean {
  const publisher = publishers.get(threadId);
  if (!publisher) return false;
  if (publisher.done) return false;
  publisher.abortController.abort();
  return true;
}

/** True when a live (not yet done) publisher exists for `threadId`. */
export function hasActivePublisher(threadId: string): boolean {
  pruneStale();
  const p = publishers.get(threadId);
  return p != null && !p.done;
}

/** Drop the entry. Called from the POST onFinish path. */
export function unregisterPublisher(threadId: string): void {
  const p = publishers.get(threadId);
  if (!p) return;
  closePublisher(p);
  publishers.delete(threadId);
}

/** Test-only helpers. */
export function __resetStreamPublishers(): void {
  for (const p of publishers.values()) closePublisher(p);
  publishers.clear();
}
export function __getPublisherCount(): number {
  return publishers.size;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function drain(
  publisher: Publisher,
  source: ReadableStream<Uint8Array>,
): Promise<void> {
  const reader = source.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      publisher.buffer.push(value);
      for (const listener of publisher.chunkListeners) {
        listener(value);
      }
    }
  } catch {
    // Upstream error — surface as done so subscribers close cleanly.
    // The error has already been logged by streamText.onError.
  } finally {
    closePublisher(publisher);
  }
}

function closePublisher(publisher: Publisher): void {
  if (publisher.done) return;
  publisher.done = true;
  for (const listener of publisher.doneListeners) {
    listener();
  }
  publisher.chunkListeners.clear();
  publisher.doneListeners.clear();
}

function pruneStale(): void {
  const now = Date.now();
  for (const [id, publisher] of publishers) {
    if (now - publisher.registeredAt > PUBLISHER_TTL_MS) {
      closePublisher(publisher);
      publishers.delete(id);
    }
  }
}
