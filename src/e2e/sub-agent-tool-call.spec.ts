import { test, expect } from "@playwright/test";
import { scriptToolCall, newThreadUrl } from "./_helpers/script-fake";

const SUB_AGENT_NAME = "DataAnalyst";
const SUB_AGENT_ID = "agent-123";
const TASK = "Summarise the sales figures for Q3";
const AGENT_RESPONSE = "Q3 totalled 4.2 million revenue, up 12 percent YoY.";
const FINAL_ANSWER =
  "I delegated the analysis as requested; see the agent box above for details.";

test.describe("sub-agent-tool-call", () => {
  // FIXME: The fake provider emits an inline tool-result for `call_sub_agent`
  // but the AI SDK appears to drop the result for this specific tool name
  // (other tool names like `search_documents` work — see
  // tool-execution-error.spec.ts). Suspect: the SDK reserves namespacing
  // for `call_sub_agent` because the route conditionally registers a real
  // implementation, even when not registered for this thread. Investigate
  // by tracing the assistant UIMessage parts emitted by AI SDK. Until
  // then this test is skipped; the final answer rendering is covered by
  // multi-turn-tool-loop which also calls `call_sub_agent`.
  test("call_sub_agent renders tool widget, response text, and parent final answer", async ({
    page,
  }) => {
    const threadUrl = await newThreadUrl(page);
    await scriptToolCall(page, {
      toolName: "call_sub_agent",
      args: { agent_id: SUB_AGENT_ID, task: TASK },
      result: {
        agentName: SUB_AGENT_NAME,
        agentId: SUB_AGENT_ID,
        model: "gpt-5.5",
        response: AGENT_RESPONSE,
        summary: `Agent "${SUB_AGENT_NAME}" responded successfully.`,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cachedTokens: 0,
          totalTokens: 150,
          costUsd: 0.001,
        },
      },
      finalText: FINAL_ANSWER,
    });

    await page.goto(threadUrl);
    const textarea = page.getByPlaceholder("Type your message...");
    await expect(textarea).toBeVisible({ timeout: 30_000 });

    await textarea.fill("Please delegate the Q3 sales analysis");
    await page.keyboard.press("Enter");

    await expect(page.getByText(FINAL_ANSWER)).toBeVisible({ timeout: 15_000 });

    // Tool widget header renders exactly once.
    await expect(
      page.getByText("tool-call_sub_agent", { exact: true }),
    ).toHaveCount(1);

    await expect(page.locator(".is-assistant")).toHaveCount(1, {
      timeout: 5_000,
    });

    // The tool widget auto-opens to "output-available" state when the
    // result is present, so the agent's response should already be in
    // the DOM. If it's not visible by default, click to expand.
    const responseLocator = page.getByText(AGENT_RESPONSE, { exact: false });
    if (!(await responseLocator.isVisible().catch(() => false))) {
      await page
        .getByText("tool-call_sub_agent", { exact: true })
        .click();
    }
    await expect(responseLocator).toBeVisible({ timeout: 5_000 });

    await expect(
      page.getByText(SUB_AGENT_NAME, { exact: false }),
    ).toBeVisible({ timeout: 5_000 });
  });
});
