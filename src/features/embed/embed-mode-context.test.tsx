import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmbedModeProvider, useEmbedMode } from "./embed-mode-context";

function Probe() {
  const { isEmbed } = useEmbedMode();
  return <span>embed:{isEmbed ? "yes" : "no"}</span>;
}

describe("embed-mode-context — useEmbedMode", () => {
  it("defaults to isEmbed=false outside a provider (normal app unaffected)", () => {
    render(<Probe />);
    expect(screen.getByText("embed:no")).toBeInTheDocument();
  });

  it("reports isEmbed=true inside EmbedModeProvider", () => {
    render(
      <EmbedModeProvider>
        <Probe />
      </EmbedModeProvider>
    );
    expect(screen.getByText("embed:yes")).toBeInTheDocument();
  });
});
