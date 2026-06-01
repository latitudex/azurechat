import { describe, it, expect, vi } from "vitest";

// ── Logger ────────────────────────────────────────────────────────────────────
vi.mock("@/features/common/services/logger", () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

// ── Auth ──────────────────────────────────────────────────────────────────────
vi.mock("@/features/auth-page/helpers", () => ({
  userHashedId: vi.fn(async () => "user-hash"),
  getCurrentUser: vi.fn(async () => ({
    name: "Test User",
    email: "test@example.com",
    isAdmin: false,
  })),
}));

// ── Thread service ────────────────────────────────────────────────────────────
const mockEnsureThread = vi.fn();
const mockUpdateThreadUsage = vi.fn(async () => ({ status: "OK" }));
vi.mock("../../chat-thread-service", () => ({
  EnsureChatThreadOperation: (...a: unknown[]) => mockEnsureThread(...a),
  UpdateChatThreadUsage: (...a: unknown[]) => mockUpdateThreadUsage(...a),
}));

// ── Message service ───────────────────────────────────────────────────────────
const mockFindHistory = vi.fn();
const mockCreateMessage = vi.fn(async () => ({ status: "OK" }));
vi.mock("../../chat-message-service", () => ({
  FindTopChatMessagesForCurrentUser: (...a: unknown[]) => mockFindHistory(...a),
  CreateChatMessage: (...a: unknown[]) => mockCreateMessage(...a),
}));

// ── Document service ──────────────────────────────────────────────────────────
vi.mock("../../chat-document-service", () => ({
  FindAllChatDocuments: vi.fn(async () => ({ status: "OK", response: [] })),
}));

// ── Extension service ─────────────────────────────────────────────────────────
vi.mock("@/features/extensions-page/extension-services/extension-service", () => ({
  FindAllExtensionForCurrentUserAndIds: vi.fn(async () => ({ status: "OK", response: [] })),
}));

// ── Responses API mapper (async, just return empty array for these tests) ─────
vi.mock("../../utils", () => ({
  mapOpenAIChatMessages: vi.fn(async () => []),
}));

import { loadThreadContext } from "../thread-context";
import { MESSAGE_ATTRIBUTE } from "../../models";
import type { ChatThreadModel, UserPrompt } from "../../models";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeThread(id = "thread-001"): ChatThreadModel {
  return {
    id,
    createdAt: new Date("2026-01-01"),
    isDeleted: false,
    userId: "user-hash",
    name: "Test thread",
    type: "CHAT_THREAD",
    bookmarked: false,
    selectedModel: "gpt-5.4-mini",
    extension: [],
    personaDocumentIds: [],
    attachedFiles: [],
  } as unknown as ChatThreadModel;
}

function makeUserPrompt(threadId = "thread-001"): UserPrompt {
  return {
    id: threadId,
    message: "Hello world",
    multimodalImage: undefined,
    multimodalImages: [],
  } as unknown as UserPrompt;
}

function makeHistoryRow(role: "user" | "assistant", content: string) {
  return {
    id: `msg-${role}`,
    createdAt: new Date("2026-01-01"),
    isDeleted: false,
    threadId: "thread-001",
    userId: "user-hash",
    name: "",
    content,
    role,
    type: MESSAGE_ATTRIBUTE,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("loadThreadContext — fresh thread (no history)", () => {
  it("creates thread via EnsureChatThreadOperation and returns history containing the new user turn", async () => {
    const thread = makeThread();
    mockEnsureThread.mockResolvedValue({ status: "OK", response: thread });
    mockFindHistory.mockResolvedValue({ status: "OK", response: [] });

    const ctx = await loadThreadContext(makeUserPrompt());

    expect(ctx.thread).toBe(thread);
    // loadThreadContext appends the just-written user message to history so
    // streamText doesn't trip over an empty prompt — see thread-context.ts.
    expect(ctx.history).toHaveLength(1);
    expect(ctx.history[0]?.role).toBe("user");
  });
});

describe("loadThreadContext — existing thread with history", () => {
  it("hydrates at least 1 UIMessage from 1 user + 1 assistant row", async () => {
    const thread = makeThread();
    mockEnsureThread.mockResolvedValue({ status: "OK", response: thread });
    // Cosmos returns newest-first; thread-context reverses before adapting.
    mockFindHistory.mockResolvedValue({
      status: "OK",
      response: [
        makeHistoryRow("assistant", "I can help with that."),
        makeHistoryRow("user", "Hello"),
      ],
    });

    const ctx = await loadThreadContext(makeUserPrompt());

    expect(ctx.history.length).toBeGreaterThanOrEqual(1);
    const roles = ctx.history.map((m) => m.role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
  });
});

describe("loadThreadContext — CreateChatMessage is called once for the new user turn", () => {
  it("calls CreateChatMessage exactly once before returning", async () => {
    const thread = makeThread();
    mockEnsureThread.mockResolvedValue({ status: "OK", response: thread });
    mockFindHistory.mockResolvedValue({ status: "OK", response: [] });
    mockCreateMessage.mockClear();

    await loadThreadContext(makeUserPrompt());

    expect(mockCreateMessage).toHaveBeenCalledTimes(1);
    const [arg] = mockCreateMessage.mock.calls[0] as [Record<string, unknown>];
    expect(arg.role).toBe("user");
    expect(arg.content).toBe("Hello world");
    // turnId is now stamped on the user row (architect2 SEV-2 B7+B8).
    expect(typeof arg.turnId).toBe("string");
    expect(arg.turnId as string).toMatch(/^turn-/);
  });
});

describe("loadThreadContext — turnId is minted per request", () => {
  it("returns a unique turnId every call", async () => {
    const thread = makeThread();
    mockEnsureThread.mockResolvedValue({ status: "OK", response: thread });
    mockFindHistory.mockResolvedValue({ status: "OK", response: [] });

    const ctxA = await loadThreadContext(makeUserPrompt());
    const ctxB = await loadThreadContext(makeUserPrompt());
    expect(ctxA.turnId).toMatch(/^turn-/);
    expect(ctxB.turnId).toMatch(/^turn-/);
    expect(ctxA.turnId).not.toBe(ctxB.turnId);
  });
});
