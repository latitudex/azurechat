import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { EmbedAgentCard } from "./embed-agent-card";
import type { PersonaModel } from "@/features/persona-page/persona-services/models";

const persona = {
  id: "p1",
  name: "Quality Inspector",
  description: "Helps with grain quality questions.",
} as unknown as PersonaModel;

describe("embed-agent-card", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the persona name and description", () => {
    render(<EmbedAgentCard persona={persona} />);
    expect(screen.getByText("Quality Inspector")).toBeInTheDocument();
    expect(
      screen.getByText("Helps with grain quality questions.")
    ).toBeInTheDocument();
  });

  it("navigates to the embed chat-creation route on Start chat", async () => {
    render(<EmbedAgentCard persona={persona} />);
    await userEvent.click(screen.getByRole("button", { name: /start chat/i }));
    expect(mockPush).toHaveBeenCalledWith("/embed/agent/p1/chat");
  });
});
