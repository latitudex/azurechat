import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  CopyAgentLinksMenu,
  buildAgentEmbedLinks,
} from "./copy-agent-links-menu";

// Radix DropdownMenu drives open/close through pointer-capture + scrollIntoView,
// which jsdom doesn't implement. Polyfill them so the menu can open in tests.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture)
    Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.releasePointerCapture)
    Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView)
    Element.prototype.scrollIntoView = () => {};
});

describe("buildAgentEmbedLinks", () => {
  it("builds the agent link, embeddable link and iframe snippet", () => {
    const links = buildAgentEmbedLinks("https://chat.example.com", "p1");
    expect(links.agentLink).toBe("https://chat.example.com/agent/p1/chat");
    expect(links.embeddableLink).toBe(
      "https://chat.example.com/embed/agent/p1"
    );
    expect(links.embedSnippet).toContain(
      '<iframe src="https://chat.example.com/embed/agent/p1"'
    );
    expect(links.embedSnippet).toContain('allow="clipboard-write"');
  });
});

describe("CopyAgentLinksMenu", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    // navigator.clipboard may be defined getter-only by another test's
    // userEvent.setup() in this worker — defineProperty replaces it.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("renders a single copy trigger button", () => {
    render(<CopyAgentLinksMenu personaId="abc" />);
    expect(
      screen.getByRole("button", { name: /copy agent links/i })
    ).toBeInTheDocument();
  });

  it("copies the embeddable link when that menu item is chosen", async () => {
    render(<CopyAgentLinksMenu personaId="abc" />);

    await userEvent.click(
      screen.getByRole("button", { name: /copy agent links/i })
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /embeddable link/i })
    );

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/embed/agent/abc`
    );
  });

  it("copies the iframe snippet when that menu item is chosen", async () => {
    render(<CopyAgentLinksMenu personaId="abc" />);

    await userEvent.click(
      screen.getByRole("button", { name: /copy agent links/i })
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /embed snippet/i })
    );

    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("<iframe");
    expect(copied).toContain(`${window.location.origin}/embed/agent/abc`);
  });
});
