"use server";
import "server-only";

import { OpenAIMiniInstance } from "@/features/common/services/openai";

export const ChatApiText = async (
  userMessage: string
) => {
  const openAI = OpenAIMiniInstance();

  const response = await openAI.chat.completions.create({
    model: "",
    max_completion_tokens: 1000,
    stream: false,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: userMessage }],
      },
    ],
    // Retain prompt cache entries for 24h (Azure OpenAI).
    // Spread-cast: `prompt_cache_retention` is an Azure OpenAI parameter
    // not yet present in the openai SDK type definitions.
    ...({ prompt_cache_retention: "24h" } as { prompt_cache_retention: string }),
  });

  return response.choices[0].message.content as string;
};
