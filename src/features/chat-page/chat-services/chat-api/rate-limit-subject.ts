import "server-only";

/**
 * rate-limit-subject.ts
 *
 * Resolves the "subject" identifier the rate-limit bucket should be keyed
 * on. Today the subject is just the hashed user id; per-org rate limits
 * become a one-line swap here once the org concept is defined
 * (architect2 SEV-2 B11).
 *
 * Why extract this:
 *   - The rate-limit module knows NOTHING about auth — it takes a string
 *     key. Without this seam, swapping per-user → per-org would mean
 *     editing route.ts, which mixes auth + provisioning concerns.
 *   - Bucket-store backend (#34 follow-up) — when we swap in-memory Map
 *     for Redis, this is also where you'd choose to KEY differently per
 *     plan tier (free = small bucket, paid = larger).
 */

import { userHashedId, getCurrentUser } from "@/features/auth-page/helpers";

/**
 * The opaque subject string used to key the rate-limit bucket.
 *
 * Format today: `user:<hashedUserId>` — explicitly namespaced so a
 * future addition like `org:<orgId>` or `tenant:<tenantId>` is
 * distinguishable in logs and won't collide with user keys if both
 * end up in the same Map.
 */
export type RateLimitSubject = string;

/**
 * Resolve the subject for the current request. Throws if the caller
 * isn't authenticated — let the route convert to 401.
 *
 * To swap to per-org limiting:
 *   1. Look up `getCurrentUser()` and read its tenant/org claim from
 *      the JWT (which currently isn't propagated through next-auth
 *      session; would need a session callback to surface it).
 *   2. Return `org:<orgId>` instead of `user:<userKey>`.
 *   3. Optionally also enforce a per-user sub-bucket so one bad actor
 *      in an org doesn't burn the whole org's quota.
 */
export async function resolveRateLimitSubject(): Promise<RateLimitSubject> {
  // Touch getCurrentUser so the error surface (unauthorized → throw) is
  // consistent with the rest of the request pipeline — userHashedId()
  // would throw a generic "User not found" which the route translates
  // to 401, same outcome.
  await getCurrentUser();
  const userKey = await userHashedId();
  return `user:${userKey}`;
}
