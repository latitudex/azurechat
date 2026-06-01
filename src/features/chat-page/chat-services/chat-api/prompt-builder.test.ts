import { describe, it, expect } from "vitest";
import { buildSystemMessage, sortFunctionTools } from "./prompt-builder";

// These tests lock down byte-for-byte stability of the parts of the request
// that participate in the Azure OpenAI prompt cache key. A regression here
// translates directly into cache misses and a 10x cost increase on the
// affected input tokens.

describe("buildSystemMessage", () => {
  const baseInputs = {
    staticSystemPrompt: "You are a friendly Test AI assistant.",
    personaMessage: "Be terse. Cite sources.",
    documentHint: "",
  };

  it("is a pure function — same inputs yield byte-identical output", () => {
    const a = buildSystemMessage(baseInputs);
    const b = buildSystemMessage(baseInputs);
    const c = buildSystemMessage({ ...baseInputs }); // different object identity, same values
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it("byte-identical across two distinct calls (no hidden state)", () => {
    const a = buildSystemMessage(baseInputs);
    // simulate a separate request lifecycle
    const inputsCopy = JSON.parse(JSON.stringify(baseInputs));
    const b = buildSystemMessage(inputsCopy);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("changes when (and only when) one of the documented inputs changes", () => {
    const baseline = buildSystemMessage(baseInputs);
    expect(buildSystemMessage({ ...baseInputs, personaMessage: "Different persona." })).not.toBe(baseline);
    expect(buildSystemMessage({ ...baseInputs, documentHint: "\n\nDOCS: foo.pdf" })).not.toBe(baseline);
    expect(buildSystemMessage({ ...baseInputs, staticSystemPrompt: "different static" })).not.toBe(baseline);
  });

  it("treats omitted documentHint as empty string", () => {
    const withEmpty = buildSystemMessage({ ...baseInputs, documentHint: "" });
    const withOmitted = buildSystemMessage({
      staticSystemPrompt: baseInputs.staticSystemPrompt,
      personaMessage: baseInputs.personaMessage,
    });
    expect(withOmitted).toBe(withEmpty);
  });

  it("does NOT inject any date — output must be stable across calendar days", () => {
    const out = buildSystemMessage({
      staticSystemPrompt: "STATIC",
      personaMessage: "PERSONA",
      documentHint: "",
    });
    // No ISO date and no "Today" marker should leak into the prompt; otherwise
    // the prompt cache would invalidate at every UTC midnight rollover.
    expect(out).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(out.toLowerCase()).not.toContain("today");
  });

  it("places dynamic segments in the documented order: static, doc-hint, persona", () => {
    const out = buildSystemMessage({
      staticSystemPrompt: "STATIC",
      personaMessage: "PERSONA",
      documentHint: "DOCHINT",
    });
    expect(out.indexOf("STATIC")).toBeLessThan(out.indexOf("DOCHINT"));
    expect(out.indexOf("DOCHINT")).toBeLessThan(out.indexOf("PERSONA"));
  });

});

describe("sortFunctionTools", () => {
  it("produces the same array regardless of input order", () => {
    const a = [{ name: "search_documents" }, { name: "call_sub_agent" }, { name: "search_company_content" }];
    const b = [{ name: "call_sub_agent" }, { name: "search_company_content" }, { name: "search_documents" }];
    const c = [{ name: "search_company_content" }, { name: "search_documents" }, { name: "call_sub_agent" }];

    const sortedA = sortFunctionTools(a);
    const sortedB = sortFunctionTools(b);
    const sortedC = sortFunctionTools(c);

    expect(JSON.stringify(sortedA)).toBe(JSON.stringify(sortedB));
    expect(JSON.stringify(sortedA)).toBe(JSON.stringify(sortedC));
  });

  it("does not mutate the input", () => {
    const original = [{ name: "z" }, { name: "a" }];
    const snapshot = JSON.stringify(original);
    sortFunctionTools(original);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("preserves all other fields on each tool entry", () => {
    const tools = [
      { name: "b", description: "desc-b", strict: true as const, parameters: { type: "object" } },
      { name: "a", description: "desc-a", strict: true as const, parameters: { type: "object" } },
    ];
    const sorted = sortFunctionTools(tools);
    expect(sorted[0]).toEqual(tools[1]);
    expect(sorted[1]).toEqual(tools[0]);
  });

  it("handles tools with missing/empty names without throwing", () => {
    const tools = [{ name: "z" }, { name: undefined }, { name: "a" }];
    expect(() => sortFunctionTools(tools as any)).not.toThrow();
  });
});

describe("byte-for-byte invariant (the cache contract)", () => {
  // This is the headline test: if these inputs are stable, the assembled
  // request prefix MUST be byte-identical, regardless of the order extensions
  // were registered or which conditional branches fired during assembly.

  const personaMessage = "Be a helpful coding assistant. Always cite line numbers when referring to code.";
  const staticSystemPrompt = "You are a friendly Bühler Chat AI assistant.\n\nFORMAT WITH MARKDOWN.";
  const today = "2026-04-30";

  it("two requests with identical thread state produce identical system messages and tool arrays", () => {
    const toolsRequest1 = [
      { name: "search_documents", description: "..." },
      { name: "call_sub_agent", description: "..." },
      { name: "search_sub_agent", description: "..." },
    ];
    // Same logical set, registered in a different order (e.g. extensions loaded async)
    const toolsRequest2 = [
      { name: "search_sub_agent", description: "..." },
      { name: "search_documents", description: "..." },
      { name: "call_sub_agent", description: "..." },
    ];

    const sys1 = buildSystemMessage({ staticSystemPrompt, personaMessage, today, documentHint: "" });
    const sys2 = buildSystemMessage({ staticSystemPrompt, personaMessage, today, documentHint: "" });
    const sortedTools1 = sortFunctionTools(toolsRequest1);
    const sortedTools2 = sortFunctionTools(toolsRequest2);

    // System message is byte-identical
    expect(Buffer.from(sys1).equals(Buffer.from(sys2))).toBe(true);
    // Tool array is byte-identical (same JSON serialization)
    expect(JSON.stringify(sortedTools1)).toBe(JSON.stringify(sortedTools2));
  });
});
