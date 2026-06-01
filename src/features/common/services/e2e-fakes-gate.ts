import "server-only";

/**
 * Single source of truth for "are e2e fakes / test-only endpoints
 * allowed to load and respond?".
 *
 * Production safety: returns false in production unless the operator
 * has explicitly opted in via `AZURECHAT_E2E_ALLOW_FAKES=1` (the E2E
 * suite needs the production BUILD with NODE_ENV=production but ALSO
 * needs the fakes to be live — that combination is the only legitimate
 * use of the override).
 *
 * Every guard MUST go through this helper. Inlining the env-check
 * pattern in each test route is what allowed the prod-fakes guard to
 * be cargo-culted (and risks a 5th caller missing one of the three
 * conditions — see architect smells audit S1.2).
 */
export function isE2eFakesAllowed(): boolean {
  if (process.env.AZURECHAT_TEST_BACKEND !== "memory") return false;
  if (
    process.env.NODE_ENV === "production" &&
    process.env.AZURECHAT_E2E_ALLOW_FAKES !== "1"
  ) {
    return false;
  }
  return true;
}

/**
 * Hard-fail variant used by `instrumentation.ts`: refuses to load
 * fakes in production unless the explicit override is set. Throws so
 * Next.js logs a clear startup failure rather than silently swapping
 * the data store.
 */
export function assertE2eFakesAllowedOrRefuse(): void {
  if (process.env.AZURECHAT_TEST_BACKEND !== "memory") return;
  if (
    process.env.NODE_ENV === "production" &&
    process.env.AZURECHAT_E2E_ALLOW_FAKES !== "1"
  ) {
    throw new Error(
      "AZURECHAT_TEST_BACKEND=memory is not permitted in production. " +
        "Refusing to load e2e fakes. Set AZURECHAT_E2E_ALLOW_FAKES=1 if " +
        "running an E2E suite against a production build.",
    );
  }
}
