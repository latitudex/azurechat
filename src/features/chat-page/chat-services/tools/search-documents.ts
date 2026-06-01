import "server-only";

import { z } from "zod";
import { tool } from "ai";
import { SimilaritySearch } from "../azure-ai-search/azure-ai-search";
import { CreateCitations, FormatCitations } from "../citation-service";
import { userHashedId } from "@/features/auth-page/helpers";
import { logInfo, logDebug, logError } from "@/features/common/services/logger";
import { AllowedPersonaDocumentIds } from "@/features/persona-page/persona-services/persona-documents-service";
import type { ToolContext } from "./tool-context";

/**
 * AI SDK v5 tool for RAG document search.
 *
 * JSON Schema matches function-registry.ts `search_documents` definition
 * exactly for prompt-cache stability.
 */
export function searchDocumentsTool(ctx: ToolContext) {
  return tool({
    description:
      "Search through documents attached to the current chat to find relevant information. " +
      "Use this when the user asks questions that might be answered by their documents. " +
      "Iterate using top (max results) and skip (offset) to paginate until you gather enough context.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "The search query to find relevant documents and information. " +
            "Should be the raw question or a summarized version which is used for semantic search."
        ),
      top: z
        .number()
        .nullable()
        .optional()
        .describe(
          "Maximum number of documents to return (default: 10). " +
            "Use a higher number if the first page lacks sufficient context."
        ),
      skip: z
        .number()
        .nullable()
        .optional()
        .describe(
          "Number of documents to skip (default: 0). " +
            "Use to paginate (e.g., skip=10 with top=10 for the second page)."
        ),
    }),
    execute: async (
      args: { query: string; top?: number | null; skip?: number | null },
      { abortSignal }: { abortSignal?: AbortSignal }
    ) => {
      logInfo("searchDocumentsTool: executing", {
        queryLength: args.query?.length ?? 0,
        top: args.top ?? 10,
        skip: args.skip ?? 0,
        threadId: ctx.threadId,
      });
      logDebug("searchDocumentsTool: query", { query: args.query });

      const top = args.top ?? 10;
      const skip = args.skip ?? 0;
      const userId = await userHashedId();

      const allowedPersonaDocumentIds =
        (await AllowedPersonaDocumentIds(ctx.personaDocumentIds)) ?? [];

      const baseFilter = `(user eq '${userId}' and chatThreadId eq '${ctx.threadId}')`;
      const personaClause =
        allowedPersonaDocumentIds.length > 0
          ? ` or search.in(personaDocumentId, '${allowedPersonaDocumentIds.join(",")}', ',')`
          : "";
      const filter = `${baseFilter}${personaClause}`;

      const searchPromise = SimilaritySearch(args.query, top, filter, skip, true);

      const documentResponse = abortSignal
        ? await Promise.race([
            searchPromise,
            new Promise<never>((_, reject) =>
              abortSignal.addEventListener("abort", () =>
                reject(new Error("Search aborted"))
              )
            ),
          ])
        : await searchPromise;

      if (documentResponse.status !== "OK") {
        logError("searchDocumentsTool: search failed", {
          errors: documentResponse.errors,
        });
        throw new Error(
          `Document search failed: ${documentResponse.errors?.[0]?.message ?? "Unknown error"}`
        );
      }

      logInfo("searchDocumentsTool: completed", {
        resultCount: documentResponse.response?.length ?? 0,
      });

      const withoutEmbedding = FormatCitations(documentResponse.response);
      const citationResponse = await CreateCitations(withoutEmbedding);

      const documents: Array<{
        id: string;
        content: string;
        metadata: string;
        relevanceScore?: number;
      }> = [];

      citationResponse.forEach((c, index) => {
        if (c.status === "OK") {
          documents.push({
            id: c.response.id,
            content: c.response.content.document.pageContent,
            metadata: c.response.content.document.metadata,
            relevanceScore: documentResponse.response[index]?.score ?? 0,
          });
        }
      });

      const contextText = documents
        .map((doc, index) => {
          const preview = doc.content.substring(0, 500);
          const ellipsis = doc.content.length > 500 ? "..." : "";
          return `[Document ${index + 1}] ${doc.metadata}\nContent: ${preview}${ellipsis}\n`;
        })
        .join("\n---\n");

      return {
        query: args.query,
        documents,
        contextText,
        summary: `Found ${documents.length} relevant documents for: "${args.query}". Use the document content to provide detailed answers.`,
        documentCount: documents.length,
      };
    },
  });
}
