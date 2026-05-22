import { describe, it, expect } from "vitest";
import { createSandboxUrlTransform } from "../sandbox-url-transform";

const SANDBOX = "sandbox:/mnt/data/red.png";
const STORED = "https://blob.example.com/red.png";

async function pipe(chunks: any[]): Promise<any[]> {
  const transform = createSandboxUrlTransform()();
  const out: any[] = [];
  const writer = transform.writable.getWriter();
  const reader = transform.readable.getReader();
  const readAll = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      out.push(value);
    }
  })();
  for (const c of chunks) await writer.write(c);
  await writer.close();
  await readAll;
  return out;
}

describe("sandbox-url-transform", () => {
  it("rewrites a sandbox URL in a later text-delta using a prior tool-result", async () => {
    const out = await pipe([
      {
        type: "tool-result",
        toolName: "code_interpreter",
        output: { outputs: [{ type: "image", url: STORED, filename: "red.png" }] },
      },
      { type: "text-delta", id: "1", text: `Here it is: ![](${SANDBOX})` },
      { type: "text-end", id: "1" },
    ]);

    const textChunks = out.filter((c) => c.type === "text-delta");
    expect(textChunks).toHaveLength(1);
    expect(textChunks[0].text).toContain(STORED);
    expect(textChunks[0].text).not.toContain(SANDBOX);
  });

  it("passes through chunks unchanged when no file map is built", async () => {
    const input = [
      { type: "text-delta", id: "1", text: "plain text" },
      { type: "text-end", id: "1" },
    ];
    const out = await pipe(input);
    expect(out).toEqual(input);
  });

  it("rewrites a sandbox URL split across many text-delta chunks (Azure's typical streaming pattern)", async () => {
    // Azure delivers sandbox URLs in fragments — observed for
    // sandbox:/mnt/data/random_pyplot.png splitting into
    // "sandbox", ":/", "mnt", "/data", "/random", "_py", "plot",
    // ".png", ")" — pre-fix the per-delta substitution never saw a
    // complete pattern and the URL leaked through to Streamdown.
    const out = await pipe([
      {
        type: "tool-result",
        toolName: "code_interpreter",
        output: { outputs: [{ type: "image", url: STORED, filename: "red.png" }] },
      },
      { type: "text-delta", id: "1", text: "Here it is: [download](" },
      { type: "text-delta", id: "1", text: "sandbox" },
      { type: "text-delta", id: "1", text: ":/" },
      { type: "text-delta", id: "1", text: "mnt" },
      { type: "text-delta", id: "1", text: "/data" },
      { type: "text-delta", id: "1", text: "/red" },
      { type: "text-delta", id: "1", text: ".png" },
      { type: "text-delta", id: "1", text: ")" },
      { type: "text-end", id: "1" },
    ]);

    const reassembled = out
      .filter((c) => c.type === "text-delta")
      .map((c) => c.text)
      .join("");
    expect(reassembled).toContain(STORED);
    expect(reassembled).not.toContain(SANDBOX);
    expect(reassembled).not.toContain("sandbox:/mnt/data");
  });

  it("flushes pending tail on text-end even if it never completed into a sandbox URL", async () => {
    const out = await pipe([
      { type: "text-delta", id: "1", text: "I will mention sandboxes briefly: sand" },
      { type: "text-end", id: "1" },
    ]);
    const reassembled = out
      .filter((c) => c.type === "text-delta")
      .map((c) => c.text)
      .join("");
    expect(reassembled).toBe("I will mention sandboxes briefly: sand");
  });

  it("ignores tool-results from other tools", async () => {
    const out = await pipe([
      {
        type: "tool-result",
        toolName: "search_documents",
        output: { outputs: [{ type: "image", url: STORED, filename: "red.png" }] },
      },
      { type: "text-delta", id: "1", text: `![](${SANDBOX})` },
      { type: "text-end", id: "1" },
    ]);
    // Unknown filename → text-delta holds the sandbox URL back, text-end
    // flushes it as a separate delta unchanged. Reassemble both halves.
    const reassembled = out
      .filter((c) => c.type === "text-delta")
      .map((c) => c.text)
      .join("");
    expect(reassembled).toContain(SANDBOX);
    expect(reassembled).not.toContain(STORED);
  });

  it("does not register a tool output whose URL is itself a sandbox path", async () => {
    const out = await pipe([
      {
        type: "tool-result",
        toolName: "code_interpreter",
        output: { outputs: [{ type: "image", url: SANDBOX, filename: "red.png" }] },
      },
      { type: "text-delta", id: "1", text: `![](${SANDBOX})` },
      { type: "text-end", id: "1" },
    ]);
    const reassembled = out
      .filter((c) => c.type === "text-delta")
      .map((c) => c.text)
      .join("");
    expect(reassembled).toContain(SANDBOX);
  });
});
