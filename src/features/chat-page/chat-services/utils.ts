import { ResponseInputItem } from "openai/resources/responses/responses"
import { ChatMessageModel } from "./models";
import { getBase64ImageReference } from "./chat-image-persistence-service";

export const mapOpenAIChatMessages = async (
  messages: ChatMessageModel[]
): Promise<ResponseInputItem[]> => {
  const mappedMessages: ResponseInputItem[] = [];
  
  for (const message of messages) {
    // Skip roles not supported by the Responses API history (e.g., tool/function)
    if (message.role === "tool" || message.role === "function") {
      continue;
    }

    if (message.role === "user" && (message.multiModalImages?.length || message.multiModalImage)) {
      const images = message.multiModalImages?.length
        ? message.multiModalImages
        : [message.multiModalImage!];

      const imageContent = await Promise.all(
        images.map(async (img) => ({
          type: "input_image" as const,
          image_url: await getBase64ImageReference(img),
        }))
      );

      mappedMessages.push({
        type: "message",
        role: message.role as any,
        content: [
          { type: "input_text", text: message.content },
          ...imageContent,
        ] as any,
      } as ResponseInputItem);
      continue;
    }
    
    // Handle other message types...
    switch (message.role) {
      case "assistant":
        mappedMessages.push({
          type: "message",
          role: message.role as any,
          content: message.content,
        } as ResponseInputItem);
        break;
      default:
        mappedMessages.push({
          type: "message",
          role: message.role,
          content: message.content,
        } as ResponseInputItem);
        break;
    }
    
    if (message.role === "assistant" && message.reasoningState) {
      mappedMessages.push(
        message.reasoningState as ResponseInputItem
      );
    }
  }
  
  return mappedMessages;
};
