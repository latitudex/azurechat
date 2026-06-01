import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockResetChatThread, mockSetMessages } = vi.hoisted(() => ({
  mockResetChatThread: vi.fn(),
  mockSetMessages: vi.fn(),
}));

vi.mock("../chat-services/chat-thread-service", () => ({
  ResetChatThread: mockResetChatThread,
}));

vi.mock("../chat-store-context", () => ({
  useChatSession: () => ({ setMessages: mockSetMessages }),
}));

// Mock Dialog to render inline without animations to avoid timeouts
vi.mock("@/features/ui/dialog", () => ({
  Dialog: ({ open, onOpenChange, children }: any) => (
    <div data-testid="dialog" data-open={String(open)}>
      {/* always render children so triggers are clickable */}
      {children}
    </div>
  ),
  DialogTrigger: ({ asChild, children }: any) => (
    <div data-testid="dialog-trigger">{children}</div>
  ),
  DialogContent: ({ children }: any) => <div data-testid="dialog-content">{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogClose: ({ asChild, children }: any) => <div data-testid="dialog-close">{children}</div>,
}));

import { ChatReset } from "./chat-reset";

describe("chat-page.unit.components — ChatReset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResetChatThread.mockResolvedValue({ status: "OK" });
  });

  it("renders a Reset Chat button", () => {
    render(<ChatReset chatThreadId="t1" />);
    expect(screen.getByTitle("Reset Chat")).toBeInTheDocument();
  });

  it("button is disabled when disabled prop is true", () => {
    render(<ChatReset chatThreadId="t1" disabled />);
    expect(screen.getByTitle("Reset Chat")).toBeDisabled();
  });

  it("button is enabled when disabled prop is false", () => {
    render(<ChatReset chatThreadId="t1" disabled={false} />);
    expect(screen.getByTitle("Reset Chat")).not.toBeDisabled();
  });

  it("shows the confirmation dialog content on render (always rendered in mock)", () => {
    render(<ChatReset chatThreadId="t1" />);
    expect(screen.getByText("Confirm Reset")).toBeInTheDocument();
    expect(screen.getByText("Are you sure you want to reset this chat?")).toBeInTheDocument();
  });

  it("confirms reset: calls ResetChatThread and removeMessages on OK response", async () => {
    render(<ChatReset chatThreadId="t1" />);
    await userEvent.click(screen.getByText("Confirm"));
    await waitFor(() => {
      expect(mockResetChatThread).toHaveBeenCalledWith("t1");
      expect(mockSetMessages).toHaveBeenCalled();
    });
  });

  it("does not call removeMessages when reset returns non-OK status", async () => {
    mockResetChatThread.mockResolvedValue({ status: "ERROR", errors: [] });
    render(<ChatReset chatThreadId="t1" />);
    await userEvent.click(screen.getByText("Confirm"));
    await waitFor(() => {
      expect(mockResetChatThread).toHaveBeenCalledWith("t1");
      expect(mockSetMessages).not.toHaveBeenCalled();
    });
  });

  it("cancel button does not call ResetChatThread", async () => {
    render(<ChatReset chatThreadId="t1" />);
    await userEvent.click(screen.getByText("Cancel"));
    expect(mockResetChatThread).not.toHaveBeenCalled();
  });
});
