import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  startPublisher,
  subscribeStream,
  abortPublisher,
  hasActivePublisher,
  unregisterPublisher,
  PUBLISHER_TTL_MS,
  __resetStreamPublishers,
  __getPublisherCount,
} from "./stream-publisher";

const enc = new TextEncoder();
const dec = new TextDecoder();

function makeSource(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(enc.encode(chunk));
      }
      controller.close();
    },
  });
}

async function drainStream(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const reader = stream.getReader();
  const results: string[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    results.push(dec.decode(value));
  }
  return results;
}

describe("stream-publisher", () => {
  beforeEach(() => {
    __resetStreamPublishers();
  });

  afterEach(() => {
    __resetStreamPublishers();
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // 1. Subscribe-after-buffer-only
  // ---------------------------------------------------------------------------
  it("subscribe after source closes replays buffer then closes", async () => {
    const { publish } = startPublisher("thread-1");
    const source = makeSource(["a", "b", "c"]);

    // Drain the source fully — publish is async (void drain(...))
    publish(source);

    // Wait for drain to finish by yielding the microtask queue
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    // Publisher is done; subscribe should still return a stream
    const stream = subscribeStream("thread-1");
    expect(stream).not.toBeNull();

    const chunks = await drainStream(stream!);
    expect(chunks).toEqual(["a", "b", "c"]);
  });

  // ---------------------------------------------------------------------------
  // 2. Subscribe-during-stream (mid-stream subscriber)
  // ---------------------------------------------------------------------------
  it("subscribe mid-stream receives buffered prefix + live chunks", async () => {
    let releaseChunk2!: () => void;
    const chunk2Ready = new Promise<void>((resolve) => (releaseChunk2 = resolve));

    const source = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(enc.encode("chunk1"));
        // Pause so we can subscribe before chunk2 arrives
        await chunk2Ready;
        controller.enqueue(enc.encode("chunk2"));
        controller.close();
      },
    });

    const { publish } = startPublisher("thread-2");
    publish(source);

    // Let chunk1 be enqueued (drain awaits the read promise)
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const stream = subscribeStream("thread-2");
    expect(stream).not.toBeNull();

    // Now release chunk2 and close
    releaseChunk2();

    const chunks = await drainStream(stream!);
    expect(chunks).toEqual(["chunk1", "chunk2"]);
  });

  // ---------------------------------------------------------------------------
  // 3. Multi-subscriber fan-out
  // ---------------------------------------------------------------------------
  it("two subscribers both receive full chunk sequence in order", async () => {
    let releaseClose!: () => void;
    const closePending = new Promise<void>((r) => (releaseClose = r));

    const source = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(enc.encode("x"));
        controller.enqueue(enc.encode("y"));
        await closePending;
        controller.enqueue(enc.encode("z"));
        controller.close();
      },
    });

    const { publish } = startPublisher("thread-3");
    publish(source);

    // Let x and y buffer
    await new Promise<void>((r) => setTimeout(r, 0));

    const streamA = subscribeStream("thread-3")!;
    const streamB = subscribeStream("thread-3")!;
    expect(streamA).not.toBeNull();
    expect(streamB).not.toBeNull();

    releaseClose();

    const [chunksA, chunksB] = await Promise.all([
      drainStream(streamA),
      drainStream(streamB),
    ]);
    expect(chunksA).toEqual(["x", "y", "z"]);
    expect(chunksB).toEqual(["x", "y", "z"]);
  });

  // ---------------------------------------------------------------------------
  // 4. abortPublisher fires AbortController.signal
  // ---------------------------------------------------------------------------
  it("abortPublisher sets signal.aborted and returns true", () => {
    const { abortController } = startPublisher("thread-4");
    expect(abortController.signal.aborted).toBe(false);

    const result = abortPublisher("thread-4");
    expect(result).toBe(true);
    expect(abortController.signal.aborted).toBe(true);
  });

  it("hasActivePublisher is false after source closes following abort", async () => {
    let abortReject!: (r: unknown) => void;
    const abortError = new Error("aborted");

    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        // Simulate abort closing the stream with an error
        abortReject = () => controller.error(abortError);
      },
    });

    const { publish } = startPublisher("thread-4b");
    publish(source);

    abortPublisher("thread-4b");
    abortReject(abortError);

    // Let drain catch and close
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(hasActivePublisher("thread-4b")).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 5. Idempotent abort
  // ---------------------------------------------------------------------------
  it("abortPublisher returns false when no publisher exists", () => {
    expect(abortPublisher("no-such-thread")).toBe(false);
  });

  it("abortPublisher returns false on second call (publisher.done is true after source closes)", async () => {
    const { publish } = startPublisher("thread-5");
    publish(makeSource(["data"]));

    // First abort while publisher is still active
    const first = abortPublisher("thread-5");
    expect(first).toBe(true);

    // Second abort on the same publisher returns false because it's not done yet
    // but the abortController already aborted — publisher.done is still false
    // until drain settles; so a second call sees it's already done === false but
    // abortController already fired. The contract says "returns true if a
    // publisher was found and aborted"; after abort publisher is still in the map
    // until drain finishes. Checking idempotency once drain finishes:
    await new Promise<void>((r) => setTimeout(r, 0));
    // Now publisher.done === true
    const second = abortPublisher("thread-5");
    expect(second).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 6. unregisterPublisher
  // ---------------------------------------------------------------------------
  it("unregisterPublisher: hasActivePublisher becomes false, subscribeStream returns null", async () => {
    const { publish } = startPublisher("thread-6");

    // Publish a stream that won't finish on its own during this test
    let keep: ReadableStreamDefaultController<Uint8Array>;
    const lingering = new ReadableStream<Uint8Array>({ start(c) { keep = c; } });
    publish(lingering);

    expect(hasActivePublisher("thread-6")).toBe(true);

    // Capture a subscriber before unregister
    const stream = subscribeStream("thread-6")!;
    expect(stream).not.toBeNull();

    unregisterPublisher("thread-6");

    expect(hasActivePublisher("thread-6")).toBe(false);
    expect(subscribeStream("thread-6")).toBeNull();
    expect(__getPublisherCount()).toBe(0);

    // In-flight subscriber should see the stream close
    const chunks = await drainStream(stream);
    expect(chunks).toEqual([]);

    // Clean up lingering controller reference
    keep!.close();
  });

  // ---------------------------------------------------------------------------
  // 7. TTL eviction
  // ---------------------------------------------------------------------------
  it("pruneStale evicts publishers older than PUBLISHER_TTL_MS", () => {
    vi.useFakeTimers();

    startPublisher("thread-7");
    expect(hasActivePublisher("thread-7")).toBe(true);

    vi.advanceTimersByTime(PUBLISHER_TTL_MS + 1);

    // subscribeStream triggers pruneStale
    const result = subscribeStream("thread-7");
    expect(result).toBeNull();
    expect(hasActivePublisher("thread-7")).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 8. Re-start for the same threadId evicts the first publisher
  // ---------------------------------------------------------------------------
  it("second startPublisher for same threadId evicts the first; each subscriber is isolated", async () => {
    let keepFirst: ReadableStreamDefaultController<Uint8Array>;
    const firstSource = new ReadableStream<Uint8Array>({
      start(c) { keepFirst = c; },
    });

    const { publish: publishFirst } = startPublisher("thread-8");
    publishFirst(firstSource);

    // Attach a subscriber to the first publisher
    const streamFirst = subscribeStream("thread-8")!;
    expect(streamFirst).not.toBeNull();

    // Start a second publisher for the same threadId — should evict the first
    const { publish: publishSecond } = startPublisher("thread-8");
    const secondSource = makeSource(["second-data"]);
    publishSecond(secondSource);

    // First subscriber should see a close (done called on eviction)
    const firstChunks = await drainStream(streamFirst);
    expect(firstChunks).toEqual([]); // evicted before any chunks

    // Second subscriber gets second publisher's data
    await new Promise<void>((r) => setTimeout(r, 0));
    const streamSecond = subscribeStream("thread-8")!;
    const secondChunks = await drainStream(streamSecond);
    expect(secondChunks).toEqual(["second-data"]);

    // Clean up
    keepFirst!.close();
  });
});
