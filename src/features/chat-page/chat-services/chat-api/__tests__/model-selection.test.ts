import { describe, it, expect, vi } from "vitest";

// ── Silence logger noise ──────────────────────────────────────────────────────
vi.mock("@/features/common/services/logger", () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

// ── Auth ──────────────────────────────────────────────────────────────────────
vi.mock("@/features/auth-page/helpers", () => ({
  userHashedId: vi.fn(async () => "test-user-hash"),
}));

// ── Usage service ─────────────────────────────────────────────────────────────
const mockCheckLimits = vi.fn(async () => ({ exceeded: false }));
vi.mock("@/features/common/services/usage-service", () => ({
  CheckLimits: (...args: unknown[]) => mockCheckLimits(...args),
}));

import { resolveModelAndLimits } from "../model-selection";
import { MODEL_CONFIGS, DEFAULT_MODEL } from "../../models";
import type { ChatThreadModel } from "../../models";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeThread(overrides: Partial<ChatThreadModel> = {}): ChatThreadModel {
  return {
    id: "thread-001",
    createdAt: new Date("2026-01-01"),
    isDeleted: false,
    userId: "user-hash",
    name: "Test thread",
    type: "CHAT_THREAD",
    bookmarked: false,
    selectedModel: DEFAULT_MODEL,
    ...overrides,
  } as ChatThreadModel;
}

// Pin a deployment name so the test doesn't depend on env vars.
const PINNED_MODEL = "gpt-5.4-mini" as const;
const PINNED_CONFIG = MODEL_CONFIGS[PINNED_MODEL];
const originalDeployment = PINNED_CONFIG.deploymentName;

beforeEach(() => {
  // Give the mini model a stable deployment name for tests.
  (MODEL_CONFIGS[PINNED_MODEL] as any).deploymentName = "mini-deployment-test";
  (MODEL_CONFIGS["gpt-5.5"] as any).deploymentName = "gpt55-deployment-test";
  mockCheckLimits.mockResolvedValue({ exceeded: false });
});

afterEach(() => {
  (MODEL_CONFIGS[PINNED_MODEL] as any).deploymentName = originalDeployment;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveModelAndLimits — explicit model in payload", () => {
  it("returns the expected modelDeployment and modelConfig for the selected model", async () => {
    const thread = makeThread({ selectedModel: "gpt-5.5" });
    const result = await resolveModelAndLimits({ selectedModel: PINNED_MODEL }, thread);

    expect(result.modelDeployment).toBe("mini-deployment-test");
    expect(result.modelConfig).toBe(MODEL_CONFIGS[PINNED_MODEL]);
    expect(result.selectedModel).toBe(PINNED_MODEL);
    expect(result.fallbackInfo.fellBack).toBe(false);
  });
});

describe("resolveModelAndLimits — falls back to thread.selectedModel when payload has none", () => {
  it("uses thread.selectedModel when payload.selectedModel is undefined", async () => {
    const thread = makeThread({ selectedModel: PINNED_MODEL });
    const result = await resolveModelAndLimits({}, thread);

    expect(result.selectedModel).toBe(PINNED_MODEL);
    expect(result.modelDeployment).toBe("mini-deployment-test");
  });
});

describe("resolveModelAndLimits — limit exceeded triggers fallback", () => {
  it("returns fellBack:true and switches to fallbackModel when limit is exceeded", async () => {
    // gpt-5.5 has fallbackModel "gpt-5.4-mini"
    mockCheckLimits.mockResolvedValue({
      exceeded: true,
      fallbackModel: "gpt-5.4-mini",
      limitType: "tokens",
      currentUsage: 50_000,
      limit: 40_000,
    });

    const thread = makeThread({ selectedModel: "gpt-5.5" });
    const result = await resolveModelAndLimits({ selectedModel: "gpt-5.5" }, thread);

    expect(result.fallbackInfo.fellBack).toBe(true);
    if (result.fallbackInfo.fellBack) {
      expect(result.fallbackInfo.originalModel).toBe("gpt-5.5");
      expect(result.fallbackInfo.fallbackModel).toBe("gpt-5.4-mini");
      expect(result.fallbackInfo.limitType).toBe("tokens");
    }
    expect(result.selectedModel).toBe("gpt-5.4-mini");
    expect(result.modelDeployment).toBe("mini-deployment-test");
  });
});
