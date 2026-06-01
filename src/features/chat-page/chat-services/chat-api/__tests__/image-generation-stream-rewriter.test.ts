import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/features/common/services/logger", () => ({
  logInfo: vi.fn(),
  logDebug: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

// The rewriter delegates upload + reference building to the image service's
// `persistBase64Image`. The test never builds a `blob://` string itself —
// the helper hands one back, and we assert that ref propagates into the
// rewritten chunk's `output.result`.
const mockPersist = vi.fn();
vi.mock("../../chat-image-persistence-service", () => ({
  persistBase64Image: (...a: unknown[]) => mockPersist(...a),
}));

import { createImageGenerationStreamRewriter } from "../image-generation-stream-rewriter";

const BIG_BASE64 = "A".repeat(4096);
const FAKE_BLOB_REF = "blob://t1/fake-ref.png";

async function pipe(threadId: string, chunks: unknown[]): Promise<unknown[]> {
  const transform = createImageGenerationStreamRewriter(threadId)();
  const out: unknown[] = [];
  const writer = transform.writable.getWriter();
  const reader = transform.readable.getReader();
  const readAll = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      out.push(value);
    }
  })();
  for (const c of chunks) await writer.write(c as never);
  await writer.close();
  await readAll;
  return out;
}

describe("createImageGenerationStreamRewriter", () => {
  beforeEach(() => {
    mockPersist.mockReset();
    mockPersist.mockResolvedValue({ status: "OK", response: FAKE_BLOB_REF });
  });

  it("hands a bare-base64 image_generation tool-result to persistBase64Image and emits the returned blob ref", async () => {
    const out = await pipe("t1", [
      {
        type: "tool-result",
        toolName: "image_generation",
        toolCallId: "call-1",
        output: { result: BIG_BASE64 },
      },
    ]);
    expect(mockPersist).toHaveBeenCalledTimes(1);
    const [threadId, dataUrl] = mockPersist.mock.calls[0];
    expect(threadId).toBe("t1");
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    expect((out[0] as { output: { result: string } }).output.result).toBe(FAKE_BLOB_REF);
  });

  it("passes a `data:image/jpeg;base64,...` result through to persistBase64Image untouched", async () => {
    const dataUrl = `data:image/jpeg;base64,${BIG_BASE64}`;
    await pipe("t1", [
      {
        type: "tool-result",
        toolName: "image_generation",
        toolCallId: "call-2",
        output: { result: dataUrl },
      },
    ]);
    expect(mockPersist).toHaveBeenCalledWith("t1", dataUrl);
  });

  it("passes non-image_generation tool-results through unchanged", async () => {
    const original = {
      type: "tool-result",
      toolName: "search_documents",
      toolCallId: "call-3",
      output: { result: BIG_BASE64 },
    };
    const out = await pipe("t1", [original]);
    expect(mockPersist).not.toHaveBeenCalled();
    expect(out[0]).toBe(original);
  });

  it("passes non-tool-result chunks (text-delta, source, etc.) through unchanged", async () => {
    const input = [
      { type: "text-delta", id: "1", text: "Hello." },
      { type: "source", sourceType: "url", url: "https://example.com" },
    ];
    const out = await pipe("t1", input);
    expect(mockPersist).not.toHaveBeenCalled();
    expect(out).toEqual(input);
  });

  it("emits the original chunk unchanged when persistBase64Image fails", async () => {
    mockPersist.mockResolvedValueOnce({
      status: "ERROR",
      errors: [{ message: "blob storage down" }],
    });
    const original = {
      type: "tool-result",
      toolName: "image_generation",
      toolCallId: "call-4",
      output: { result: BIG_BASE64 },
    };
    const out = await pipe("t1", [original]);
    expect((out[0] as { output: { result: string } }).output.result).toBe(BIG_BASE64);
  });

  it("emits the original chunk when output.result isn't a base64 payload (too short)", async () => {
    const original = {
      type: "tool-result",
      toolName: "image_generation",
      toolCallId: "call-5",
      output: { result: "tiny" },
    };
    const out = await pipe("t1", [original]);
    expect(mockPersist).not.toHaveBeenCalled();
    expect(out[0]).toBe(original);
  });

  it("passes existing blob:// references through without re-persisting", async () => {
    const original = {
      type: "tool-result",
      toolName: "image_generation",
      toolCallId: "call-6",
      output: { result: "blob://t1/already-persisted.png" },
    };
    const out = await pipe("t1", [original]);
    expect(mockPersist).not.toHaveBeenCalled();
    expect(out[0]).toBe(original);
  });
});
