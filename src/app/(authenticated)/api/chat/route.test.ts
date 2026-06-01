/**
 * Smoke test for the legacy route.test.ts location.
 * The canonical tests for the AI SDK v6 rewrite live in __tests__/route.test.ts.
 * This file is kept to satisfy any coverage tool that still references this path.
 */
import { describe, it, expect } from "vitest";
import { POST, maxDuration } from "./route";

describe("/api/chat route (smoke)", () => {
  it("exports a POST handler", () => {
    expect(typeof POST).toBe("function");
  });

  it("exports maxDuration = 600", () => {
    expect(maxDuration).toBe(600);
  });
});
