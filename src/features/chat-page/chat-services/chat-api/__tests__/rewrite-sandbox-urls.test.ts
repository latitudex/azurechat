import { describe, it, expect } from "vitest";
import type { UIMessage } from "ai";
import {
  rewriteSandboxUrls,
  rewriteSandboxUrlsInMessage,
} from "../rewrite-sandbox-urls";

const SANDBOX_URL = "sandbox:/mnt/data/red_background_image.png";
const STORED_URL = "https://blob.example.com/threads/t1/red_background_image.png";

function assistantMessage(parts: UIMessage["parts"]): UIMessage {
  return {
    id: "msg-1",
    role: "assistant",
    parts,
  } as UIMessage;
}

describe("rewrite-sandbox-urls", () => {
  it("rewrites a sandbox URL in a text part using a code_interpreter tool output", () => {
    const msg = assistantMessage([
      {
        type: "tool-code_interpreter",
        output: {
          outputs: [{ type: "image", url: STORED_URL }],
        },
      } as any,
      {
        type: "text",
        text: `Here is the file: ![red](${SANDBOX_URL})`,
      } as any,
    ]);

    const { message, unresolved } = rewriteSandboxUrlsInMessage(msg);
    const text = (message.parts.find((p) => p.type === "text") as any).text;
    expect(text).toContain(STORED_URL);
    expect(text).not.toContain(SANDBOX_URL);
    expect(unresolved).toEqual([]);
  });

  it("uses caller-supplied preIngested URLs (the onFinish path for container files)", () => {
    const msg = assistantMessage([
      {
        type: "text",
        text: `Here is the file: ![red](${SANDBOX_URL})`,
      } as any,
    ]);
    const preIngested = new Map<string, string>([
      ["red_background_image.png", "/api/images?t=t1&img=red_background_image.png"],
    ]);

    const { message, unresolved } = rewriteSandboxUrlsInMessage(msg, preIngested);
    const text = (message.parts.find((p) => p.type === "text") as any).text;
    expect(text).toContain("/api/images?t=t1&img=red_background_image.png");
    expect(text).not.toContain(SANDBOX_URL);
    expect(unresolved).toEqual([]);
  });

  it("preIngested entries override harvested ones for the same filename", () => {
    const msg = assistantMessage([
      {
        type: "tool-code_interpreter",
        output: {
          outputs: [
            { type: "image", url: "https://harvested/red.png", filename: "red.png" },
          ],
        },
      } as any,
      { type: "text", text: "![](sandbox:/mnt/data/red.png)" } as any,
    ]);
    const preIngested = new Map<string, string>([
      ["red.png", "/api/images?t=t1&img=red.png"],
    ]);
    const { message } = rewriteSandboxUrlsInMessage(msg, preIngested);
    const text = (message.parts.find((p) => p.type === "text") as any).text;
    expect(text).toContain("/api/images?t=t1&img=red.png");
    expect(text).not.toContain("https://harvested/red.png");
  });

  it("rewrites a sandbox URL via dynamic-tool with toolName=image_generation", () => {
    const msg = assistantMessage([
      {
        type: "dynamic-tool",
        toolName: "image_generation",
        output: {
          outputs: [{ type: "image", url: STORED_URL, filename: "red_background_image.png" }],
        },
      } as any,
      {
        type: "text",
        text: `![alt](${SANDBOX_URL})`,
      } as any,
    ]);

    const { message } = rewriteSandboxUrlsInMessage(msg);
    const text = (message.parts.find((p) => p.type === "text") as any).text;
    expect(text).toBe(`![alt](${STORED_URL})`);
  });

  it("leaves the URL untouched when no tool output matches the filename, and reports it", () => {
    const msg = assistantMessage([
      {
        type: "text",
        text: `![unknown](${SANDBOX_URL})`,
      } as any,
    ]);

    const { message, unresolved } = rewriteSandboxUrlsInMessage(msg);
    const text = (message.parts.find((p) => p.type === "text") as any).text;
    expect(text).toContain(SANDBOX_URL);
    expect(unresolved).toContain("red_background_image.png");
  });

  it("does not rewrite when the tool output URL is itself a sandbox path", () => {
    const msg = assistantMessage([
      {
        type: "tool-code_interpreter",
        output: {
          outputs: [{ type: "image", url: SANDBOX_URL }],
        },
      } as any,
      {
        type: "text",
        text: `![red](${SANDBOX_URL})`,
      } as any,
    ]);

    const { message, unresolved } = rewriteSandboxUrlsInMessage(msg);
    const text = (message.parts.find((p) => p.type === "text") as any).text;
    expect(text).toContain(SANDBOX_URL);
    expect(unresolved).toContain("red_background_image.png");
  });

  it("returns the same message reference when nothing changes (cheap for non-image turns)", () => {
    const msg = assistantMessage([
      { type: "text", text: "Plain reply, no images." } as any,
    ]);
    const { message } = rewriteSandboxUrlsInMessage(msg);
    expect(message).toBe(msg);
  });

  it("only rewrites assistant messages, never user/system", () => {
    const userMsg: UIMessage = {
      id: "u",
      role: "user",
      parts: [{ type: "text", text: `[link](${SANDBOX_URL})` } as any],
    } as UIMessage;
    const { message } = rewriteSandboxUrlsInMessage(userMsg);
    expect(message).toBe(userMsg);
  });

  it("rewrites across a full conversation array", () => {
    const conversation: UIMessage[] = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "make a red square" } as any],
      } as UIMessage,
      assistantMessage([
        {
          type: "tool-code_interpreter",
          output: {
            outputs: [{ type: "image", url: STORED_URL }],
          },
        } as any,
        { type: "text", text: `Done! ![red](${SANDBOX_URL})` } as any,
      ]),
    ];

    const { messages, unresolved } = rewriteSandboxUrls(conversation);
    const text = (messages[1].parts.find((p) => p.type === "text") as any).text;
    expect(text).toContain(STORED_URL);
    expect(unresolved).toEqual([]);
  });
});
