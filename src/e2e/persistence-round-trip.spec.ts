import { test, expect } from "@playwright/test";
import { scriptComplex, newThreadUrl } from "./_helpers/script-fake";

// Verifies a single streamed assistant message containing reasoning + a tool
// call + final text all renders correctly with no duplicate widgets and no
// orphan bubble.

const REASONING_TEXT = "I should look up the weather first before answering.";
const TOOL_NAME = "get_weather";
const FINAL_ANSWER =
  "Based on my reasoning and the weather tool: it is 18 degrees Celsius and partly cloudy in Zurich.";

test.describe("persistence-round-trip", () => {
  test("complex message (reasoning + tool call + text) all render in one stream", async ({
    page,
  }) => {
    const threadUrl = await newThreadUrl(page);
    await scriptComplex(page, {
      reasoning: REASONING_TEXT,
      toolCalls: [
        {
          toolName: TOOL_NAME,
          args: { city: "Zurich" },
          result: { temperature: "18", condition: "partly cloudy" },
        },
      ],
      finalText: FINAL_ANSWER,
    });

    await page.goto(threadUrl);
    const textarea = page.getByPlaceholder("Type your message...");
    await expect(textarea).toBeVisible({ timeout: 30_000 });

    await textarea.fill("What is the weather in Zurich?");
    await page.keyboard.press("Enter");

    // Final answer must render — stream fully consumed.
    await expect(page.getByText(FINAL_ANSWER)).toBeVisible({ timeout: 15_000 });

    // Tool widget renders exactly once.
    await expect(
      page.getByText(`tool-${TOOL_NAME}`, { exact: true }),
    ).toHaveCount(1);

    // Reasoning section trigger renders.
    await expect(
      page.getByText(/Thinking\.\.\.|Thought for \d+|Reasoning/, { exact: false }),
    ).toBeVisible({ timeout: 5_000 });

    // Reasoning text is in the DOM (CollapsibleContent, may be collapsed).
    await expect(
      page.getByText(REASONING_TEXT, { exact: false }),
    ).toBeAttached({ timeout: 5_000 });

    // Exactly one assistant bubble.
    await expect(page.locator(".is-assistant")).toHaveCount(1, {
      timeout: 5_000,
    });
  });
});
