import { describe, it, expect, beforeEach } from "vitest";
import {
  register,
  reset,
  SERVICE_KEYS,
} from "@/features/common/services/service-container";
import { resolveAzureModel } from "../provider";
import { MODEL_CONFIGS } from "../../models";
import type { ChatModel } from "../../models";
import type { AiProviderFn } from "../provider";

describe("resolveAzureModel — DI seam", () => {
  beforeEach(() => {
    // Clear registry so each test starts clean.
    reset();

    // Register a fake provider that returns a stub whose modelId equals the
    // deployment name passed in — sufficient to prove the seam is wired.
    const fakeFactory = (): AiProviderFn =>
      (deploymentName: string) =>
        ({ modelId: deploymentName, provider: "fake" }) as any;

    register(SERVICE_KEYS.aiProvider, fakeFactory);
  });

  it("returns a model whose modelId matches the deployment name from MODEL_CONFIGS", () => {
    const modelId: ChatModel = "gpt-5.5";
    const expectedDeployment = MODEL_CONFIGS[modelId].deploymentName;

    // deploymentName comes from an env var; in unit-test context it is
    // undefined unless set. We set it explicitly so the test is hermetic.
    process.env.AZURE_OPENAI_API_GPT55_DEPLOYMENT_NAME = "gpt-55-test-deploy";
    // Re-read the config value after env is set (config is built at module
    // load so we read the same reference, but deploymentName was already
    // captured as undefined — patch it directly for the test).
    (MODEL_CONFIGS[modelId] as any).deploymentName = "gpt-55-test-deploy";

    const result = resolveAzureModel(modelId);

    expect(result.modelId).toBe("gpt-55-test-deploy");
  });

  it("throws when no deploymentName is configured for the model", () => {
    const modelId: ChatModel = "gpt-5.5";
    // Remove deployment name to simulate missing env var.
    (MODEL_CONFIGS[modelId] as any).deploymentName = undefined;

    expect(() => resolveAzureModel(modelId)).toThrow(/no deploymentName/);
  });
});
