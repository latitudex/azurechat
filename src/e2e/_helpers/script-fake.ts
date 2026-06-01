/**
 * Test helpers for scripting the in-memory fake AI provider.
 *
 * Use these instead of `page.route('**\/api/chat', ...)` for new specs.
 * The page.route() pattern was bound to chat-store.tsx's custom SSE
 * envelope (deleted with task #12) and cannot fake the AI-SDK-v6
 * UI-message-stream protocol that useChat now consumes.
 *
 * Usage:
 *   await scriptText(page, "Hello from the assistant!");
 *   await scriptReasoning(page, "Let me think...", "The answer is 42.");
 *   await scriptToolCall(page, { toolName: "search", args: {q:"x"}, result: {...}, finalText: "Done." });
 *   await scriptError(page, "Simulated network failure");
 *   await clearScript(page); // optional cleanup
 *
 * The endpoint is only mounted when AZURECHAT_TEST_BACKEND=memory.
 */
import type { Page } from "@playwright/test";

type Script =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; reasoning: string; text: string }
  | {
      kind: "toolCall";
      toolName: string;
      args: Record<string, unknown>;
      result: Record<string, unknown>;
      finalText: string;
    }
  | {
      kind: "complex";
      reasoning?: string;
      toolCalls?: Array<{
        toolName: string;
        args: Record<string, unknown>;
        result: Record<string, unknown>;
      }>;
      finalText: string;
    }
  | { kind: "error"; errorMessage: string };

async function setScript(page: Page, script: Script): Promise<void> {
  const res = await page.request.post("/api/test/set-script", {
    data: JSON.stringify(script),
    headers: { "content-type": "application/json" },
  });
  if (res.status() !== 200) {
    throw new Error(
      `set-script returned ${res.status()}: ${await res.text()}`,
    );
  }
}

export async function scriptText(page: Page, text: string): Promise<void> {
  return setScript(page, { kind: "text", text });
}

export async function scriptReasoning(
  page: Page,
  reasoning: string,
  text: string,
): Promise<void> {
  return setScript(page, { kind: "reasoning", reasoning, text });
}

export async function scriptToolCall(
  page: Page,
  args: {
    toolName: string;
    args: Record<string, unknown>;
    result: Record<string, unknown>;
    finalText: string;
  },
): Promise<void> {
  return setScript(page, { kind: "toolCall", ...args });
}

export async function scriptError(
  page: Page,
  errorMessage: string,
): Promise<void> {
  return setScript(page, { kind: "error", errorMessage });
}

export async function scriptComplex(
  page: Page,
  args: {
    reasoning?: string;
    toolCalls?: Array<{
      toolName: string;
      args: Record<string, unknown>;
      result: Record<string, unknown>;
    }>;
    finalText: string;
  },
): Promise<void> {
  return setScript(page, { kind: "complex", ...args });
}

export async function clearScript(page: Page): Promise<void> {
  await page.request.delete("/api/test/set-script");
}

/**
 * Reset a thread's messages — used in beforeEach for specs that share
 * the `/chat/temporary` thread, to avoid order-dependent state leak
 * from prior tests accumulating messages.
 *
 * Hashed-id for the per-user temporary thread; the same constant the
 * /chat/temporary route resolves to for the test user.
 */
export const TEMP_THREAD_ID =
  "973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b";

export async function resetThread(
  page: Page,
  threadId: string = TEMP_THREAD_ID,
): Promise<void> {
  const res = await page.request.post(
    `/api/test/reset-thread?threadId=${encodeURIComponent(threadId)}`,
  );
  if (res.status() !== 200) {
    throw new Error(
      `reset-thread returned ${res.status()}: ${await res.text()}`,
    );
  }
}

/**
 * Create a fresh empty thread for a single test. Returns the thread URL
 * (`/chat/<id>`) ready to pass to `page.goto`. Use this in `beforeEach`
 * for specs that share `/chat/temporary` and suffer from cross-test
 * state leaks (task #38). Each call yields a unique thread id so two
 * tests can never see each other's messages.
 */
export async function newThreadUrl(page: Page): Promise<string> {
  const res = await page.request.post("/api/test/new-thread");
  if (res.status() !== 200) {
    throw new Error(
      `new-thread returned ${res.status()}: ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { id: string; url: string };
  return body.url;
}

