import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── module mocks ────────────────────────────────────────────────────────────
vi.mock("@/features/common/services/logger", () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("@/features/auth-page/helpers", () => ({
  userHashedId: vi.fn(async () => "hashed-user"),
  getCurrentUser: vi.fn(async () => ({
    name: "Test",
    email: "test@example.com",
    isAdmin: false,
    token: "tok",
  })),
}));

vi.mock("@/features/persona-page/persona-services/persona-documents-service", () => ({
  AllowedPersonaDocumentIds: vi.fn(async () => []),
}));

vi.mock("@/features/persona-page/persona-services/persona-service", () => ({
  FindPersonaByID: vi.fn(async () => ({
    status: "NOT_FOUND",
    errors: [{ message: "not found" }],
  })),
  FindAllPersonaForCurrentUser: vi.fn(async () => ({ status: "OK", response: [] })),
}));

vi.mock("../azure-ai-search/azure-ai-search", () => ({
  SimilaritySearch: vi.fn(async () => ({ status: "OK", response: [] })),
}));

vi.mock("../citation-service", () => ({
  CreateCitations: vi.fn(async () => []),
  FormatCitations: vi.fn((docs: any[]) => docs),
}));

vi.mock("../models/provider", () => ({
  resolveAzureModel: vi.fn(() => ({ modelId: "gpt-5.4-mini" })),
}));

// ─── subject under test ───────────────────────────────────────────────────────
import { buildToolset } from "../registry";
import type { ToolContext } from "../tool-context";
import type { ExtensionModel } from "@/features/extensions-page/extension-services/models";

// ─── helpers ─────────────────────────────────────────────────────────────────
function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    user: "user-hash",
    threadId: "thread-1",
    threadDocumentIds: [],
    personaDocumentIds: [],
    defaultTools: {},
    extensions: [],
    ...overrides,
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────
describe("buildToolset – key ordering invariant", () => {
  it("returns keys in localeCompare ascending order (empty context)", async () => {
    const toolset = await buildToolset(makeCtx());
    const keys = Object.keys(toolset);
    const sorted = [...keys].sort((a, b) => a.localeCompare(b));
    expect(keys).toEqual(sorted);
  });

  it("returns keys in localeCompare ascending order (all features enabled)", async () => {
    const ctx = makeCtx({
      threadDocumentIds: ["doc-1"],
      defaultTools: { companyContent: true },
    });
    const toolset = await buildToolset(ctx);
    const keys = Object.keys(toolset);
    const sorted = [...keys].sort((a, b) => a.localeCompare(b));
    expect(keys).toEqual(sorted);
  });

  it("keys remain sorted even when extension tools have names that collide alphabetically", async () => {
    const fakeExtension: ExtensionModel = {
      id: "ext-1",
      name: "My Extension",
      description: "test",
      executionSteps: "steps",
      headers: [],
      userId: "user-1",
      isPublished: true,
      createdAt: new Date(),
      type: "EXTENSION",
      functions: [
        {
          id: "fn-a",
          functionName: "zz_last",
          code: JSON.stringify({
            name: "zz_last",
            description: "z tool",
            parameters: { type: "object", properties: {}, required: [] },
          }),
          endpoint: "https://example.com/zz",
          endpointType: "POST",
          isOpen: false,
        },
        {
          id: "fn-b",
          functionName: "aa_first",
          code: JSON.stringify({
            name: "aa_first",
            description: "a tool",
            parameters: { type: "object", properties: {}, required: [] },
          }),
          endpoint: "https://example.com/aa",
          endpointType: "POST",
          isOpen: false,
        },
      ],
    };

    const ctx = makeCtx({
      extensions: [{ extension: fakeExtension, headerSecrets: {} }],
    });
    const toolset = await buildToolset(ctx);
    const keys = Object.keys(toolset);
    const sorted = [...keys].sort((a, b) => a.localeCompare(b));
    expect(keys).toEqual(sorted);
    // Verify both tools present
    expect(keys).toContain("aa_first");
    expect(keys).toContain("zz_last");
  });
});

describe("buildToolset – conditional tool inclusion", () => {
  it("omits search_documents when no documents in context", async () => {
    const ctx = makeCtx({ threadDocumentIds: [], personaDocumentIds: [] });
    const toolset = await buildToolset(ctx);
    expect(Object.keys(toolset)).not.toContain("search_documents");
  });

  it("includes search_documents when thread has documents", async () => {
    const ctx = makeCtx({ threadDocumentIds: ["doc-1"] });
    const toolset = await buildToolset(ctx);
    expect(Object.keys(toolset)).toContain("search_documents");
  });

  it("includes search_documents when persona has documents", async () => {
    const ctx = makeCtx({ personaDocumentIds: ["pdoc-1"] });
    const toolset = await buildToolset(ctx);
    expect(Object.keys(toolset)).toContain("search_documents");
  });

  it("omits search_company_content when toggle is off", async () => {
    const ctx = makeCtx({ defaultTools: { companyContent: false } });
    const toolset = await buildToolset(ctx);
    expect(Object.keys(toolset)).not.toContain("search_company_content");
  });

  it("includes search_company_content when toggle is on", async () => {
    const ctx = makeCtx({ defaultTools: { companyContent: true } });
    const toolset = await buildToolset(ctx);
    expect(Object.keys(toolset)).toContain("search_company_content");
  });

  it("includes call_sub_agent and search_sub_agent when the thread declares subAgentIds", async () => {
    const ctx = makeCtx({ defaultTools: {}, subAgentIds: ["a1"], depth: 0 });
    const toolset = await buildToolset(ctx);
    expect(Object.keys(toolset)).toContain("call_sub_agent");
    expect(Object.keys(toolset)).toContain("search_sub_agent");
  });

  it("ALSO includes sub-agent tools when subAgentIds is empty — any persona can be called", async () => {
    const ctx = makeCtx({ defaultTools: {}, subAgentIds: [], depth: 0 });
    const toolset = await buildToolset(ctx);
    expect(Object.keys(toolset)).toContain("call_sub_agent");
    expect(Object.keys(toolset)).toContain("search_sub_agent");
  });

  it("ALSO includes sub-agent tools when subAgentIds is undefined — discovery via search_sub_agent", async () => {
    const ctx = makeCtx({ defaultTools: {}, depth: 0 });
    const toolset = await buildToolset(ctx);
    expect(Object.keys(toolset)).toContain("call_sub_agent");
    expect(Object.keys(toolset)).toContain("search_sub_agent");
  });

  it("excludes sub-agent tools at depth >= 2 (recursion guard)", async () => {
    const ctx = makeCtx({ defaultTools: {}, subAgentIds: ["a1"], depth: 2 });
    const toolset = await buildToolset(ctx);
    expect(Object.keys(toolset)).not.toContain("call_sub_agent");
    expect(Object.keys(toolset)).not.toContain("search_sub_agent");
  });
});

describe("buildToolset – extension tools", () => {
  it("registers extension tools by parsed function name", async () => {
    const fakeExtension: ExtensionModel = {
      id: "ext-2",
      name: "Ext2",
      description: "d",
      executionSteps: "s",
      headers: [],
      userId: "u",
      isPublished: true,
      createdAt: new Date(),
      type: "EXTENSION",
      functions: [
        {
          id: "fn-1",
          functionName: "my_api_call",
          code: JSON.stringify({
            name: "my_api_call",
            description: "desc",
            parameters: { type: "object", properties: {}, required: [] },
          }),
          endpoint: "https://api.example.com/call",
          endpointType: "POST",
          isOpen: false,
        },
      ],
    };

    const ctx = makeCtx({
      extensions: [{ extension: fakeExtension, headerSecrets: { "x-api-key": "secret" } }],
    });
    const toolset = await buildToolset(ctx);
    expect(Object.keys(toolset)).toContain("my_api_call");
  });

  it("skips extension functions with unparseable code without throwing", async () => {
    const fakeExtension: ExtensionModel = {
      id: "ext-3",
      name: "Ext3",
      description: "d",
      executionSteps: "s",
      headers: [],
      userId: "u",
      isPublished: true,
      createdAt: new Date(),
      type: "EXTENSION",
      functions: [
        {
          id: "fn-bad",
          functionName: "bad_fn",
          code: "NOT VALID JSON {{{",
          endpoint: "https://api.example.com",
          endpointType: "GET",
          isOpen: false,
        },
      ],
    };

    const ctx = makeCtx({
      extensions: [{ extension: fakeExtension, headerSecrets: {} }],
    });
    // Should not throw
    const toolset = await buildToolset(ctx);
    expect(Object.keys(toolset)).not.toContain("bad_fn");
  });
});

describe("buildToolset – sample sorted output", () => {
  it("emits expected key order for a realistic context", async () => {
    const ctx = makeCtx({
      threadDocumentIds: ["d1"],
      defaultTools: { companyContent: true },
      subAgentIds: ["a1"],
      depth: 0,
    });
    const toolset = await buildToolset(ctx);
    const keys = Object.keys(toolset);
    // Spot-check: call_sub_agent < search_company_content < search_documents < search_sub_agent
    expect(keys.indexOf("call_sub_agent")).toBeLessThan(
      keys.indexOf("search_company_content")
    );
    expect(keys.indexOf("search_company_content")).toBeLessThan(
      keys.indexOf("search_documents")
    );
    expect(keys.indexOf("search_documents")).toBeLessThan(
      keys.indexOf("search_sub_agent")
    );
  });
});
