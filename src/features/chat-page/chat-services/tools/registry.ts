import "server-only";

import type { Tool } from "@ai-sdk/provider-utils";
import { logInfo, logError } from "@/features/common/services/logger";
import { searchDocumentsTool } from "./search-documents";
import { searchCompanyContentTool } from "./search-company-content";
import { callSubAgentTool } from "./call-sub-agent";
import { searchSubAgentTool } from "./search-sub-agent";
import { getCurrentTimeTool } from "./get-current-time";
import { extensionTool } from "./extension-tool";
import type { ToolContext } from "./tool-context";

/**
 * Builds the toolset for a given ToolContext.
 *
 * Keys are inserted in localeCompare ascending order so that the wire
 * representation is byte-identical across requests — this is the
 * prompt-cache stability invariant locked by the snapshot test in task 3.
 *
 * Never modifies function-registry.ts; runs in parallel with the old
 * dispatcher until task-12 cutover.
 */
export async function buildToolset(
  ctx: ToolContext
): Promise<Record<string, Tool>> {
  const entries: [string, Tool][] = [];

  // RAG search — include when the thread or persona has documents
  const hasDocuments =
    (ctx.threadDocumentIds?.length ?? 0) > 0 ||
    (ctx.personaDocumentIds?.length ?? 0) > 0;

  if (hasDocuments) {
    entries.push(["search_documents", searchDocumentsTool(ctx)]);
  }

  // Company content — controlled by defaultTools toggle
  if (ctx.defaultTools?.companyContent) {
    entries.push(["search_company_content", searchCompanyContentTool(ctx)]);
  }

  // Current time — always available. Lets the model fetch the user's local
  // datetime on demand instead of baking it into the (cache-sensitive) prompt.
  entries.push(["get_current_time", getCurrentTimeTool(ctx)]);

  // Sub-agent tools are always available (subject to the recursion
  // guard). There is no "fixed assignment" — any persona the user has
  // access to can be called as a sub-agent. `search_sub_agent` lets
  // the model discover candidates via `FindAllPersonaForCurrentUser`;
  // `call_sub_agent` resolves the chosen id via `FindPersonaByID`,
  // which enforces access control. Hiding the tools when the thread
  // doesn't pre-declare `subAgentIds` was a #37 regression — it
  // prevented discovery entirely. The #37 root cause was a test-fake
  // race (inline-emitted tool result fighting a local `execute`); in
  // production these are pure custom tools owned only by us.
  const includeSubAgentTools = (ctx.depth ?? 0) < 2;

  if (includeSubAgentTools) {
    entries.push(["call_sub_agent", callSubAgentTool(ctx)]);
    entries.push(["search_sub_agent", searchSubAgentTool(ctx)]);
  }

  // Dynamic extension tools
  for (const { extension, headerSecrets } of ctx.extensions ?? []) {
    for (const functionDef of extension.functions) {
      try {
        const parsedFunction = JSON.parse(functionDef.code) as {
          name: string;
          description: string;
          parameters: any;
        };
        const t = extensionTool(functionDef, parsedFunction, {
          extension,
          headerSecrets,
        });
        entries.push([parsedFunction.name, t]);
      } catch (error) {
        logError("buildToolset: failed to parse extension function", {
          extensionId: extension.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // Sort by localeCompare for prompt-cache stability
  entries.sort(([a], [b]) => a.localeCompare(b));

  const toolset: Record<string, Tool> = {};
  for (const [name, t] of entries) {
    toolset[name] = t;
  }

  logInfo("buildToolset: built", {
    keys: Object.keys(toolset),
    depth: ctx.depth ?? 0,
  });

  return toolset;
}
