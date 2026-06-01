import { test, expect } from "@playwright/test";
import { scriptToolCall, newThreadUrl } from "./_helpers/script-fake";

const TOOL_NAME = "get_weather";
const FINAL_ANSWER = "It's 15 degrees and sunny in Zurich right now.";

test.describe("tool-call", () => {
  test.setTimeout(60_000); // cold-start tail safety; see abort-stream.spec.ts

  test("question → tool call → answer renders the tool exactly once", async ({ page }) => {
    const threadUrl = await newThreadUrl(page);
    await scriptToolCall(page, {
      toolName: TOOL_NAME,
      args: { city: "Zurich" },
      result: { temperature: "15", condition: "sunny", city: "Zurich" },
      finalText: FINAL_ANSWER,
    });

    await page.goto(threadUrl);
    const textarea = page.getByPlaceholder("Type your message...");
    await expect(textarea).toBeVisible({ timeout: 30_000 });

    await textarea.fill("What's the weather in Zurich?");
    await page.keyboard.press("Enter");

    // Final answer renders (proves the stream was consumed end-to-end).
    await expect(page.getByText(FINAL_ANSWER)).toBeVisible({ timeout: 15_000 });

    // The tool widget (ToolHeader renders `tool-<name>`) appears exactly once.
    await expect(page.getByText(`tool-${TOOL_NAME}`, { exact: true })).toHaveCount(1);

    // Exactly one assistant bubble — the real reply with the tool widget
    // above it.
    await expect(page.locator(".is-assistant")).toHaveCount(1, { timeout: 5_000 });
    const onlyAssistantText = (await page.locator(".is-assistant").innerText()).trim();
    expect(onlyAssistantText).toContain(FINAL_ANSWER);
    expect(onlyAssistantText).toContain(`tool-${TOOL_NAME}`);
  });
});
