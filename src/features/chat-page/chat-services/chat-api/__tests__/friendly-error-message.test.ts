import { describe, it, expect } from "vitest";

// Mock the side-effect-heavy deps so persist-assistant.ts can be imported
// without dragging in Cosmos / auth / logger at module load.
import { vi } from "vitest";
vi.mock("@/features/common/services/logger", () => ({
  logInfo: vi.fn(),
  logDebug: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));
vi.mock("@/features/auth-page/helpers", () => ({
  userHashedId: vi.fn(async () => "u1"),
}));
vi.mock("@/features/common/services/usage-service", () => ({
  IncrementUsage: vi.fn(async () => {}),
}));
vi.mock("@/features/common/services/cosmos", () => ({
  HistoryContainer: vi.fn(),
}));
vi.mock("../../chat-message-service", () => ({
  UpsertChatMessage: vi.fn(async () => ({ status: "OK" })),
}));
vi.mock("../../chat-thread-service", () => ({
  UpdateChatThreadUsage: vi.fn(async () => ({ status: "OK" })),
}));
vi.mock("../../chat-file-store-ingest", () => ({
  ingestContainerFileSourcesToChatStore: vi.fn(async () => new Map()),
  ingestImageGenerationResults: vi.fn(async (_t: string, r: unknown[]) => r),
}));

import { friendlyErrorMessage } from "../persist-assistant";

describe("friendlyErrorMessage", () => {
  it("never leaks the raw exception message or stack into the output", () => {
    const out = friendlyErrorMessage({
      message: "ECONNREFUSED at /Users/me/secret/path:42:0",
      name: "Error",
    });
    expect(out).not.toContain("/Users");
    expect(out).not.toContain("ECONNREFUSED");
  });

  it.each([
    ["429 rate limit exceeded", /rate-limited|over quota/],
    ["Too many requests, retry later", /rate-limited|over quota/],
    ["Status 401 Unauthorized", /permission/],
    ["403 Forbidden", /permission/],
    ["Access denied to deployment", /permission/],
    ["Response blocked by content filter", /safety filter/],
    ["Content policy violation", /safety filter/],
    ["operation timed out after 60s", /took too long/],
    ["fetch failed", /Couldn.t reach/],
    ["URL scheme must be http, https, or data, got blob:", /attachments|attachment/],
  ])("maps %j → user-facing copy", (raw, pattern) => {
    expect(friendlyErrorMessage({ message: raw })).toMatch(pattern);
  });

  it("recognises AbortError by name even when the message is vague", () => {
    expect(
      friendlyErrorMessage({ message: "The operation was aborted.", name: "AbortError" }),
    ).toMatch(/cancelled/);
  });

  it("recognises AI_DownloadError by name even when the message is vague", () => {
    expect(
      friendlyErrorMessage({ message: "something downloady broke", name: "AI_DownloadError" }),
    ).toMatch(/attachments|attachment/);
  });

  it("falls back to a generic friendly message for unknown errors", () => {
    const out = friendlyErrorMessage({ message: "weird internal thing nobody asked for" });
    expect(out).toMatch(/Something went wrong/);
    expect(out).not.toContain("weird internal thing");
  });

  it("emits italic-styled markdown so it stands out in the chat bubble", () => {
    // The sentinel template wraps the copy in `_…_` so Streamdown renders
    // it as italics. Locks the convention so a future edit doesn't strip it.
    const out = friendlyErrorMessage({ message: "rate limit" });
    expect(out.startsWith("_")).toBe(true);
    expect(out.endsWith("_")).toBe(true);
  });
});
