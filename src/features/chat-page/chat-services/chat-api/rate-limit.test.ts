import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  consumeRateLimitToken,
  __resetRateLimits,
} from "./rate-limit";

describe("rate-limit", () => {
  beforeEach(() => {
    __resetRateLimits();
    delete process.env.AZURECHAT_RATE_LIMIT_DISABLED;
    delete process.env.AZURECHAT_RATE_LIMIT_MAX;
    delete process.env.AZURECHAT_RATE_LIMIT_REFILL;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows the first N requests up to the bucket capacity", () => {
    process.env.AZURECHAT_RATE_LIMIT_MAX = "3";
    for (let i = 0; i < 3; i++) {
      expect(consumeRateLimitToken("user-a")).toEqual({ allowed: true });
    }
  });

  it("blocks the (N+1)th request and returns retryAfterSeconds", () => {
    process.env.AZURECHAT_RATE_LIMIT_MAX = "2";
    process.env.AZURECHAT_RATE_LIMIT_REFILL = "60"; // 1 token / second
    consumeRateLimitToken("user-a");
    consumeRateLimitToken("user-a");

    const result = consumeRateLimitToken("user-a");
    expect(result.allowed).toBe(false);
    if (result.allowed === false) {
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("isolates buckets per user key", () => {
    process.env.AZURECHAT_RATE_LIMIT_MAX = "1";
    expect(consumeRateLimitToken("user-a").allowed).toBe(true);
    expect(consumeRateLimitToken("user-b").allowed).toBe(true);
    expect(consumeRateLimitToken("user-a").allowed).toBe(false);
    expect(consumeRateLimitToken("user-b").allowed).toBe(false);
  });

  it("refills tokens after the configured interval", () => {
    process.env.AZURECHAT_RATE_LIMIT_MAX = "2";
    process.env.AZURECHAT_RATE_LIMIT_REFILL = "60"; // 1 token / second
    consumeRateLimitToken("user-a");
    consumeRateLimitToken("user-a");
    expect(consumeRateLimitToken("user-a").allowed).toBe(false);

    // Advance 1.1 s — should refill ~1 token.
    vi.advanceTimersByTime(1_100);
    expect(consumeRateLimitToken("user-a").allowed).toBe(true);
    expect(consumeRateLimitToken("user-a").allowed).toBe(false);
  });

  it("respects AZURECHAT_RATE_LIMIT_DISABLED=1 (test bypass)", () => {
    process.env.AZURECHAT_RATE_LIMIT_DISABLED = "1";
    for (let i = 0; i < 100; i++) {
      expect(consumeRateLimitToken("user-a").allowed).toBe(true);
    }
  });
});
