import "server-only";

import { z } from "zod";
import { tool } from "ai";
import type { ToolContext } from "./tool-context";

/**
 * `get_current_time` — returns the current datetime on demand.
 *
 * The current date is intentionally kept OUT of the system prompt (which would
 * invalidate the prompt cache every UTC midnight). The model calls this tool
 * when it needs the time. We return the user's local ISO 8601 datetime (with
 * UTC offset) forwarded by the browser via `x-client-datetime`, so answers are
 * in the user's timezone; if it's absent (older clients, server-to-server,
 * tests) we fall back to the server's UTC clock.
 *
 * Name and description are deliberately tiny to save tokens.
 */
export function getCurrentTimeTool(ctx: ToolContext) {
  return tool({
    description: "Get the current date and time (the user's local time).",
    inputSchema: z.object({}),
    execute: async () => ({
      datetime: ctx.clientDateTime ?? new Date().toISOString(),
    }),
  });
}
