import { describe, it, expect } from "vitest";
import {
  uiMessagesFromChatMessages,
  chatMessagesFromUIMessages,
} from "../message-adapter";
import { ChatMessageModel, MESSAGE_ATTRIBUTE } from "../../models";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let seq = 0;
function makeId() {
  return `id-${++seq}`;
}

function baseRow(overrides: Partial<ChatMessageModel>): ChatMessageModel {
  return {
    id: makeId(),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    isDeleted: false,
    threadId: "thread-1",
    userId: "user-1",
    name: "",
    content: "",
    role: "user",
    type: MESSAGE_ATTRIBUTE,
    ...overrides,
  };
}

const CTX = { threadId: "thread-1", userId: "user-1" };

// ---------------------------------------------------------------------------
// Structural equivalence helper
// ---------------------------------------------------------------------------

/**
 * Compare rows structurally, ignoring id and createdAt because those are
 * regenerated on the return trip (UIMessage carries no Cosmos-level ids).
 */
function stripVolatile(row: ChatMessageModel) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, createdAt, ...rest } = row;
  return rest;
}

// ---------------------------------------------------------------------------
// 1. Plain user + assistant (no tools, no reasoning)
// ---------------------------------------------------------------------------

describe("plain conversation (user + assistant)", () => {
  const rows: ChatMessageModel[] = [
    baseRow({ id: "u1", role: "user", content: "Hello" }),
    baseRow({ id: "a1", role: "assistant", content: "Hi there!" }),
  ];

  it("produces two UIMessages with correct roles", () => {
    const msgs = uiMessagesFromChatMessages(rows);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
  });

  it("text parts carry the right content", () => {
    const msgs = uiMessagesFromChatMessages(rows);
    const userText = msgs[0].parts.find((p) => p.type === "text") as any;
    const assistantText = msgs[1].parts.find((p) => p.type === "text") as any;
    expect(userText.text).toBe("Hello");
    expect(assistantText.text).toBe("Hi there!");
  });

  it("round-trips structurally", () => {
    const msgs = uiMessagesFromChatMessages(rows);
    const back = chatMessagesFromUIMessages(msgs, CTX);
    expect(back.map(stripVolatile)).toEqual(rows.map(stripVolatile));
  });
});

// ---------------------------------------------------------------------------
// 2. Assistant + 1 tool call
// ---------------------------------------------------------------------------

describe("assistant with one tool call", () => {
  const toolContent = JSON.stringify({
    name: "web_search",
    arguments: JSON.stringify({ query: "azurechat" }),
    result: JSON.stringify({ hits: 3 }),
    call_id: "call-abc",
  });

  const rows: ChatMessageModel[] = [
    baseRow({ id: "u1", role: "user", content: "search for azurechat" }),
    baseRow({ id: "a1", role: "assistant", content: "Sure, searching…" }),
    baseRow({ id: "t1", role: "tool", name: "web_search", content: toolContent }),
  ];

  it("folds the tool row into the assistant UIMessage", () => {
    const msgs = uiMessagesFromChatMessages(rows);
    expect(msgs).toHaveLength(2); // user + assistant (tool folded in)
    const assistantParts = msgs[1].parts;
    const toolPart = assistantParts.find((p) => p.type === "dynamic-tool") as any;
    expect(toolPart).toBeDefined();
    expect(toolPart.toolName).toBe("web_search");
    expect(toolPart.state).toBe("output-available");
  });

  it("round-trips structurally (3 rows in → 3 rows out)", () => {
    const msgs = uiMessagesFromChatMessages(rows);
    const back = chatMessagesFromUIMessages(msgs, CTX);
    expect(back).toHaveLength(3);
    expect(back.map(stripVolatile)).toEqual(rows.map(stripVolatile));
  });
});

// ---------------------------------------------------------------------------
// 3. Assistant + 2 tool calls
// ---------------------------------------------------------------------------

describe("assistant with two tool calls", () => {
  const tool1 = JSON.stringify({
    name: "get_weather",
    arguments: JSON.stringify({ city: "Zurich" }),
    result: JSON.stringify({ temp: 18 }),
    call_id: "call-1",
  });
  const tool2 = JSON.stringify({
    name: "get_weather",
    arguments: JSON.stringify({ city: "Berne" }),
    result: JSON.stringify({ temp: 16 }),
    call_id: "call-2",
  });

  const rows: ChatMessageModel[] = [
    baseRow({ role: "user", content: "Weather in Zurich and Berne?" }),
    baseRow({ role: "assistant", content: "Let me check…" }),
    baseRow({ role: "tool", name: "get_weather", content: tool1 }),
    baseRow({ role: "tool", name: "get_weather", content: tool2 }),
  ];

  it("folds both tool rows into the one assistant UIMessage", () => {
    const msgs = uiMessagesFromChatMessages(rows);
    expect(msgs).toHaveLength(2);
    const toolParts = msgs[1].parts.filter((p) => p.type === "dynamic-tool");
    expect(toolParts).toHaveLength(2);
  });

  it("tool parts carry distinct call ids", () => {
    const msgs = uiMessagesFromChatMessages(rows);
    const toolParts = msgs[1].parts.filter((p) => p.type === "dynamic-tool") as any[];
    const ids = toolParts.map((p) => p.toolCallId);
    expect(new Set(ids).size).toBe(2);
  });

  it("round-trips structurally (4 rows in → 4 rows out)", () => {
    const msgs = uiMessagesFromChatMessages(rows);
    const back = chatMessagesFromUIMessages(msgs, CTX);
    expect(back).toHaveLength(4);
    expect(back.map(stripVolatile)).toEqual(rows.map(stripVolatile));
  });
});

// ---------------------------------------------------------------------------
// 4. Assistant + reasoning + tool call
// ---------------------------------------------------------------------------

describe("assistant with reasoning and one tool", () => {
  const toolContent = JSON.stringify({
    name: "calculator",
    arguments: JSON.stringify({ expr: "2+2" }),
    result: "4",
    call_id: "call-r1",
  });

  const rows: ChatMessageModel[] = [
    baseRow({ role: "user", content: "What is 2+2?" }),
    baseRow({
      role: "assistant",
      content: "The answer is 4.",
      reasoningContent: "I need to compute 2+2.",
      reasoningState: { encrypted: "blob" },
    }),
    baseRow({ role: "tool", name: "calculator", content: toolContent }),
  ];

  it("creates a reasoning part before the text part", () => {
    const msgs = uiMessagesFromChatMessages(rows);
    const assistant = msgs[1];
    const reasoningIdx = assistant.parts.findIndex((p) => p.type === "reasoning");
    const textIdx = assistant.parts.findIndex((p) => p.type === "text");
    expect(reasoningIdx).toBeGreaterThanOrEqual(0);
    expect(reasoningIdx).toBeLessThan(textIdx);
  });

  it("reasoning text is preserved", () => {
    const msgs = uiMessagesFromChatMessages(rows);
    const reasoningPart = msgs[1].parts.find((p) => p.type === "reasoning") as any;
    expect(reasoningPart.text).toBe("I need to compute 2+2.");
  });

  it("reasoningState survives the round-trip via metadata", () => {
    const msgs = uiMessagesFromChatMessages(rows);
    const meta = (msgs[1].metadata ?? {}) as any;
    expect(meta.reasoningState).toEqual({ encrypted: "blob" });

    const back = chatMessagesFromUIMessages(msgs, CTX);
    const assistantRow = back.find((r) => r.role === "assistant")!;
    expect(assistantRow.reasoningState).toEqual({ encrypted: "blob" });
  });

  it("round-trips structurally (3 rows in → 3 rows out)", () => {
    const msgs = uiMessagesFromChatMessages(rows);
    const back = chatMessagesFromUIMessages(msgs, CTX);
    expect(back).toHaveLength(3);
    expect(back.map(stripVolatile)).toEqual(rows.map(stripVolatile));
  });
});

// ---------------------------------------------------------------------------
// 5. Multi-turn conversation with tools across turns
// ---------------------------------------------------------------------------

describe("multi-turn conversation with tools across turns", () => {
  const tool1 = JSON.stringify({
    name: "fetch_url",
    arguments: JSON.stringify({ url: "https://example.com" }),
    result: "<html>…</html>",
    call_id: "call-mt1",
  });
  const tool2 = JSON.stringify({
    name: "summarise",
    arguments: JSON.stringify({ text: "<html>…</html>" }),
    result: "A page about example.com",
    call_id: "call-mt2",
  });

  const rows: ChatMessageModel[] = [
    baseRow({ role: "user", content: "Summarise example.com" }),
    baseRow({ role: "assistant", content: "" }),
    baseRow({ role: "tool", name: "fetch_url", content: tool1 }),
    baseRow({ role: "assistant", content: "Here is the summary." }),
    baseRow({ role: "tool", name: "summarise", content: tool2 }),
    baseRow({ role: "user", content: "Thanks!" }),
    baseRow({ role: "assistant", content: "You're welcome!" }),
  ];

  it("produces 4 UIMessages (user + 2 assistants with tools folded + user + assistant)", () => {
    const msgs = uiMessagesFromChatMessages(rows);
    // user, assistant(+tool1), assistant(+tool2), user, assistant
    expect(msgs).toHaveLength(5);
  });

  it("each tool row is folded into its preceding assistant", () => {
    const msgs = uiMessagesFromChatMessages(rows);
    // second UIMessage is first assistant, has fetch_url tool
    const firstAssistant = msgs[1];
    const tool1Part = firstAssistant.parts.find((p) => p.type === "dynamic-tool") as any;
    expect(tool1Part?.toolName).toBe("fetch_url");

    // third UIMessage is second assistant, has summarise tool
    const secondAssistant = msgs[2];
    const tool2Part = secondAssistant.parts.find((p) => p.type === "dynamic-tool") as any;
    expect(tool2Part?.toolName).toBe("summarise");
  });

  it("round-trips structurally (7 rows in → 7 rows out)", () => {
    const msgs = uiMessagesFromChatMessages(rows);
    const back = chatMessagesFromUIMessages(msgs, CTX);
    expect(back).toHaveLength(7);
    expect(back.map(stripVolatile)).toEqual(rows.map(stripVolatile));
  });
});

// ---------------------------------------------------------------------------
// 6. User message with multiModalImages
// ---------------------------------------------------------------------------

describe("user message with multiModalImages", () => {
  const rows: ChatMessageModel[] = [
    baseRow({
      role: "user",
      content: "Describe this image",
      multiModalImages: ["https://blob.example.com/img1.png", "https://blob.example.com/img2.png"],
    }),
    baseRow({ role: "assistant", content: "These are two images." }),
  ];

  it("images become FileUIPart entries on the user UIMessage", () => {
    const msgs = uiMessagesFromChatMessages(rows);
    const fileParts = msgs[0].parts.filter((p) => p.type === "file") as any[];
    expect(fileParts).toHaveLength(2);
    expect(fileParts[0].url).toBe("https://blob.example.com/img1.png");
    expect(fileParts[1].url).toBe("https://blob.example.com/img2.png");
  });

  it("round-trips image URLs structurally", () => {
    const msgs = uiMessagesFromChatMessages(rows);
    const back = chatMessagesFromUIMessages(msgs, CTX);
    const userRow = back.find((r) => r.role === "user")!;
    expect(userRow.multiModalImages).toEqual([
      "https://blob.example.com/img1.png",
      "https://blob.example.com/img2.png",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 7. Stray tool row (no preceding assistant) — edge case
// ---------------------------------------------------------------------------

describe("stray tool row without preceding assistant", () => {
  const toolContent = JSON.stringify({
    name: "orphan_tool",
    arguments: "{}",
    result: "done",
    call_id: "call-orphan",
  });

  const rows: ChatMessageModel[] = [
    baseRow({ role: "tool", name: "orphan_tool", content: toolContent }),
  ];

  it("creates a synthetic assistant UIMessage and folds the tool part in", () => {
    const msgs = uiMessagesFromChatMessages(rows);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("assistant");
    const toolPart = msgs[0].parts.find((p) => p.type === "dynamic-tool") as any;
    expect(toolPart?.toolName).toBe("orphan_tool");
  });
});

// ---------------------------------------------------------------------------
// 8. Deleted rows are skipped
// ---------------------------------------------------------------------------

describe("deleted rows", () => {
  const rows: ChatMessageModel[] = [
    baseRow({ role: "user", content: "Keep me" }),
    baseRow({ role: "user", content: "Delete me", isDeleted: true }),
    baseRow({ role: "assistant", content: "Response" }),
  ];

  it("skips rows with isDeleted=true", () => {
    const msgs = uiMessagesFromChatMessages(rows);
    const texts = msgs
      .flatMap((m) => m.parts)
      .filter((p) => p.type === "text")
      .map((p) => (p as any).text);
    expect(texts).not.toContain("Delete me");
    expect(texts).toContain("Keep me");
  });
});

// ---------------------------------------------------------------------------
// 9. Empty rows array
// ---------------------------------------------------------------------------

describe("image_generation tool result with blob:// reference", () => {
  it("passes the persisted blob:// reference through unchanged — server NEVER resolves it", () => {
    // The contract: `blob://` is the canonical storage token and stays on
    // the server side of every boundary, including the model's view of
    // history. The UI tool widget (tool-part-view.tsx) resolves to a
    // `/api/images?...` URL at render time. Resolving here would leak the
    // URL into convertToModelMessages, the model would echo it as
    // markdown on follow-up turns, and Streamdown would render every
    // image twice.
    const toolRow = baseRow({
      role: "tool",
      name: "image_generation",
      content: JSON.stringify({
        name: "image_generation",
        arguments: "{}",
        result: JSON.stringify({
          result: "blob://thread-1/imagegen-call-1.png",
        }),
        call_id: "call-1",
      }),
    });
    const assistantRow = baseRow({ role: "assistant", content: "" });
    const msgs = uiMessagesFromChatMessages([assistantRow, toolRow]);

    const toolPart = msgs[0].parts.find(
      (p) => (p as { type: string }).type === "dynamic-tool",
    ) as { output: { result: string } } | undefined;
    expect(toolPart).toBeDefined();
    expect(toolPart!.output.result).toBe("blob://thread-1/imagegen-call-1.png");
    expect(toolPart!.output.result).not.toMatch(/^\/api\/images/);
  });
});

describe("empty input", () => {
  it("returns empty array for no rows", () => {
    expect(uiMessagesFromChatMessages([])).toEqual([]);
  });

  it("returns empty array for no messages", () => {
    expect(chatMessagesFromUIMessages([], CTX)).toEqual([]);
  });
});
