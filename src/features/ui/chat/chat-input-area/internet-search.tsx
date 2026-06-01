"use client";
import { Globe } from "lucide-react";
import { Button } from "../../button";
import { ExtensionModel } from "@/features/extensions-page/extension-services/models";
import { useChatStore } from "@/features/chat-page/chat-store-context";
import {
  AddExtensionToChatThread,
  RemoveExtensionFromChatThread,
} from "@/features/chat-page/chat-services/chat-thread-service";
import { RevalidateCache } from "@/features/common/navigation-helpers";
import { showError } from "@/features/globals/global-message-store";
import { useState } from "react";

export const InternetSearch = (props: { extension: ExtensionModel; threadExtensions: string[] }) => {
  const [threadExtensions, setThreadExtensions] = useState<string[]>(props.threadExtensions);
  const chatThreadId = useChatStore((s) => s.threadId);

  const toggleInstall = async () => {
    const isInstalled = threadExtensions.includes(props.extension.id);

    const newThreadExtensions = isInstalled
      ? threadExtensions.filter((id) => id !== props.extension.id)
      : [...threadExtensions, props.extension.id];

    setThreadExtensions(newThreadExtensions);

    try {
      const response = isInstalled
        ? await RemoveExtensionFromChatThread({ extensionId: props.extension.id, chatThreadId })
        : await AddExtensionToChatThread({ extensionId: props.extension.id, chatThreadId });
      RevalidateCache({ page: "chat", type: isInstalled ? undefined : "layout" });
      if (response.status !== "OK") {
        showError(response.errors[0].message);
        setThreadExtensions(threadExtensions);
      }
    } catch (error) {
      setThreadExtensions(threadExtensions); // Revert to the original state
    }
  };

  return (
    <>
      <Button
        size="icon"
        variant={threadExtensions.includes(props.extension.id) ? "default" : "ghost"}
        type="button"
        aria-label="Internet Access"
        onClick={toggleInstall}
      >
        <Globe size={16} />
      </Button>
    </>
  );
};
