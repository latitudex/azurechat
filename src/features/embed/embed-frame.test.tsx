import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmbedFrame } from "./embed-frame";

describe("embed-frame", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the title and children", () => {
    render(
      <EmbedFrame title="My Agent">
        <p>body</p>
      </EmbedFrame>
    );
    expect(screen.getByText("My Agent")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("omits the 'Open in full app' button when no fullAppHref is given", () => {
    render(<EmbedFrame title="My Agent">x</EmbedFrame>);
    expect(
      screen.queryByRole("button", { name: /open in full app/i })
    ).not.toBeInTheDocument();
  });

  it("navigates the top window to the canonical app URL on click", async () => {
    render(
      <EmbedFrame title="My Agent" fullAppHref="/chat/123">
        x
      </EmbedFrame>
    );
    // jsdom window.top === window; spy on its location assignment target.
    const topLocation = { href: "" } as Location;
    Object.defineProperty(window, "top", {
      configurable: true,
      value: { location: topLocation },
    });

    await userEvent.click(
      screen.getByRole("button", { name: /open in full app/i })
    );
    expect(topLocation.href).toBe(`${window.location.origin}/chat/123`);
  });
});
