import "server-only";

/**
 * Per-user request rate limit for /api/chat.
 *
 * Why this exists: the route deliberately drops `req.signal` and runs
 * `consumeStream()` fire-and-forget so streams complete in the background
 * after the client disconnects. Without a cap, an authenticated user (or a
 * stolen session) can POST + disconnect in a tight loop and drain the
 * Azure OpenAI budget — `stopWhen: stepCountIs(8)` × sub-agent depth 2 ×
 * another 8 steps each = up to ~72 model calls per request, with
 * `maxDuration = 600s`.
 *
 * Implementation: simple in-memory token bucket keyed on hashedUserId.
 * Per-container Map — Azure Container Apps may run multiple replicas, so
 * the effective limit is `MAX_TOKENS × replicaCount`. Good enough as a
 * floor; a distributed limiter (Redis) is a follow-up.
 *
 * Tunables via env:
 *   AZURECHAT_RATE_LIMIT_MAX     — max in-flight + queued per user
 *                                  (default 8)
 *   AZURECHAT_RATE_LIMIT_REFILL  — token refill per minute
 *                                  (default 8 → 1 token every 7.5 s)
 *   AZURECHAT_RATE_LIMIT_DISABLED — set to "1" to bypass (tests only)
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

function getConfig() {
  if (process.env.AZURECHAT_RATE_LIMIT_DISABLED === "1") {
    return { disabled: true as const };
  }
  const max = Number(process.env.AZURECHAT_RATE_LIMIT_MAX ?? "8");
  const refillPerMinute = Number(process.env.AZURECHAT_RATE_LIMIT_REFILL ?? "8");
  return {
    disabled: false as const,
    max: Number.isFinite(max) && max > 0 ? max : 8,
    refillPerMinute:
      Number.isFinite(refillPerMinute) && refillPerMinute > 0
        ? refillPerMinute
        : 8,
  };
}

/**
 * Attempts to consume one token for `userKey`. Returns:
 *   { allowed: true } when the request may proceed.
 *   { allowed: false, retryAfterSeconds } when the user is over-budget.
 *
 * Exported for testing — `__resetRateLimits` clears the in-memory state.
 */
export function consumeRateLimitToken(userKey: string): RateLimitResult {
  const config = getConfig();
  if (config.disabled) return { allowed: true };

  const now = Date.now();
  const refillIntervalMs = (60_000 * 1) / config.refillPerMinute;

  let bucket = buckets.get(userKey);
  if (!bucket) {
    bucket = { tokens: config.max, lastRefill: now };
    buckets.set(userKey, bucket);
  }

  // Refill — count whole intervals elapsed since last refill.
  const elapsed = now - bucket.lastRefill;
  if (elapsed >= refillIntervalMs) {
    const tokensToAdd = Math.floor(elapsed / refillIntervalMs);
    bucket.tokens = Math.min(config.max, bucket.tokens + tokensToAdd);
    bucket.lastRefill += tokensToAdd * refillIntervalMs;
  }

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true };
  }

  const retryAfterSeconds = Math.ceil(
    (refillIntervalMs - (now - bucket.lastRefill)) / 1000
  );
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, retryAfterSeconds),
  };
}

export function __resetRateLimits() {
  buckets.clear();
}

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };
