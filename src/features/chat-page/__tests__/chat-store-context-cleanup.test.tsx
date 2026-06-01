/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, act } from "@testing-library/react";

// Capture every chat.stop made by the provider.
const stopSpy = vi.fn();
const sendMessageSpy = vi.fn();
const setMessagesSpy = vi.fn();

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    id: "test",
    messages: [],
    status: "ready" as const,
    sendMessage: sendMessageSpy,
    stop: stopSpy,
    setMessages: setMessagesSpy,
    error: undefined,
  }),
}));

vi.mock("ai", () => ({
  DefaultChatTransport: class {
    constructor(_: unknown) {}
  },
}));

vi.mock("../chat-store-factory", () => ({
  createChatStore: () => ({
    getState: () => ({
      threadId: "x",
      selectedModel: "gpt-5.5",
      reasoningEffort: "low",
      webSearchEnabled: false,
      imageGenerationEnabled: false,
      companyContentEnabled: false,
      codeInterpreterEnabled: false,
      getCodeInterpreterFileIds: () => [],
    }),
    subscribe: () => () => {},
  }),
}));

import { ChatStoreProvider } from "../chat-store-context";

describe("ChatStoreProvider — thread switch", () => {
  beforeEach(() => {
    stopSpy.mockClear();
    sendMessageSpy.mockClear();
    setMessagesSpy.mockClear();
  });

  it("does NOT call chat.stop() on unmount — letting the in-flight stream complete in the background so the server can persist via onFinish", () => {
    // Background: user switches threads mid-generation. We want the original
    // request to keep running server-side (its onFinish handler persists the
    // assistant message). Calling chat.stop() on unmount aborts the request,
    // so we deliberately don't.
    const Tree = ({ tid }: { tid: string }) => (
      <ChatStoreProvider
        key={tid}
        threadId={tid}
        userName="dev"
        chatThread={{ id: tid } as any}
      >
        <div />
      </ChatStoreProvider>
    );

    const { rerender, unmount } = render(<Tree tid="A" />);
    expect(stopSpy).not.toHaveBeenCalled();

    // Simulate navigation to a different thread (key changes -> unmount/remount)
    act(() => {
      rerender(<Tree tid="B" />);
    });
    expect(stopSpy).not.toHaveBeenCalled();

    unmount();
    expect(stopSpy).not.toHaveBeenCalled();
  });
});
