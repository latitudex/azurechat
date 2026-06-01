import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const mockUserHashedId = vi.fn();
const mockGetCurrentUser = vi.fn();

vi.mock("@/features/auth-page/helpers", () => ({
  userHashedId: () => mockUserHashedId(),
  getCurrentUser: () => mockGetCurrentUser(),
}));

import { resolveRateLimitSubject } from "./rate-limit-subject";

describe("rate-limit-subject", () => {
  beforeEach(() => {
    mockUserHashedId.mockReset();
    mockGetCurrentUser.mockReset();
  });

  it("returns `user:<hashedId>` when authenticated", async () => {
    mockGetCurrentUser.mockResolvedValue({
      name: "Alice",
      email: "alice@example.com",
      isAdmin: false,
    });
    mockUserHashedId.mockResolvedValue("hash-abc");

    const subject = await resolveRateLimitSubject();
    expect(subject).toBe("user:hash-abc");
  });

  it("propagates the auth error when not authenticated", async () => {
    mockGetCurrentUser.mockRejectedValue(new Error("User not found"));
    await expect(resolveRateLimitSubject()).rejects.toThrow(/User not found/);
  });

  it("uses the `user:` namespace prefix (so future `org:` keys don't collide)", async () => {
    mockGetCurrentUser.mockResolvedValue({ email: "x@y", name: "x", isAdmin: false });
    mockUserHashedId.mockResolvedValue("h");
    const subject = await resolveRateLimitSubject();
    expect(subject.startsWith("user:")).toBe(true);
  });
});
