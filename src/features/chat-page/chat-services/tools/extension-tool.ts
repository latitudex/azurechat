import "server-only";

import { tool, jsonSchema } from "ai";
import { userHashedId } from "@/features/auth-page/helpers";
import { logDebug, logError } from "@/features/common/services/logger";
import type { ExtensionModel, ExtensionFunctionModel } from "@/features/extensions-page/extension-services/models";
import type { Tool } from "@ai-sdk/provider-utils";
import { assertExtensionUrlAllowed } from "./extension-url-guard";

export interface ExtensionToolOptions {
  extension: ExtensionModel;
  /** Header key→value secrets already resolved from Key Vault. */
  headerSecrets: Record<string, string>;
}

/**
 * Wraps one ExtensionFunctionModel entry as an AI SDK v5 Tool.
 *
 * The JSON Schema embedded in functionDef.code is lifted via `jsonSchema()`
 * so the AI SDK can present it to the provider without requiring a Zod schema.
 *
 * Note: jsonSchema() performs NO runtime validation by default — it passes the
 * raw schema straight to the model. This is intentional: extension schemas are
 * authored externally and may use constructs (e.g. $ref, allOf) that Zod cannot
 * represent. The absence of a validate callback means execute() receives `unknown`
 * input; we cast it to `any` and forward to the HTTP endpoint as-is.
 *
 * execute() throws on any HTTP error; the AI SDK emits a typed `tool-error` part.
 */
/**
 * Shape of arguments the model emits for an extension call. The JSON
 * Schema is externally-authored (extension-config) and not Zod-checked,
 * so this is the loosest sensible runtime contract:
 *   - `query`: a map of name → primitive that fills URL path/query holes
 *   - `body`: an arbitrary JSON-shaped object for non-GET methods
 */
interface ExtensionArgs {
  query?: Record<string, unknown>;
  body?: unknown;
}

function isExtensionArgs(value: unknown): value is ExtensionArgs {
  return typeof value === "object" && value !== null;
}

export function extensionTool(
  functionDef: ExtensionFunctionModel,
  parsedFunction: { name: string; description: string; parameters: unknown },
  { extension, headerSecrets }: ExtensionToolOptions
): Tool {
  const schema = jsonSchema(parsedFunction.parameters as Record<string, unknown>);

  return tool({
    description: parsedFunction.description,
    inputSchema: schema,
    execute: async (rawArgs: unknown, { abortSignal }: { abortSignal?: AbortSignal }) => {
      const args: ExtensionArgs = isExtensionArgs(rawArgs) ? rawArgs : {};
      logDebug("extensionTool: executing", {
        functionName: parsedFunction.name,
        argsKeys: Object.keys(args),
        extensionId: extension.id,
      });

      const userId = await userHashedId();

      const mergedHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        ...headerSecrets,
        authorization: userId,
      };

      let url = functionDef.endpoint;
      const requestInit: RequestInit = {
        method: functionDef.endpointType,
        headers: mergedHeaders,
        cache: "no-store",
        signal: abortSignal,
      };

      // Handle query parameters (mirrors registerDynamicFunction)
      if (args.query) {
        const queryParams = new URLSearchParams();
        for (const [key, value] of Object.entries(args.query)) {
          if (url.includes(key)) {
            url = url.replace(key, String(value));
          } else {
            queryParams.append(key, String(value));
          }
        }
        url += (url.includes("?") ? "&" : "?") + queryParams.toString();
      }

      // Handle body parameters
      const method = functionDef.endpointType;
      if (
        args.body !== undefined &&
        (method === "POST" || method === "PUT" || method === "PATCH")
      ) {
        requestInit.body = JSON.stringify(args.body);
      }

      // SSRF guard: refuse private/link-local/loopback addresses and
      // non-https schemes. Without this check any user-authored extension
      // could pivot to internal services (Cosmos, Key Vault, Azure IMDS).
      try {
        await assertExtensionUrlAllowed(url);
      } catch (err) {
        logError("extensionTool: URL rejected by SSRF guard", {
          functionName: parsedFunction.name,
          extensionId: extension.id,
          reason: err instanceof Error ? err.message : String(err),
        });
        throw new Error(
          `Extension "${parsedFunction.name}" endpoint is not allowed`
        );
      }

      const response = await fetch(url, requestInit);

      if (!response.ok) {
        logError("extensionTool: HTTP error", {
          functionName: parsedFunction.name,
          status: response.status,
        });
        throw new Error(
          `Extension "${parsedFunction.name}" failed with status ${response.status}`
        );
      }

      const result = await response.json();
      return result;
    },
  });
}
