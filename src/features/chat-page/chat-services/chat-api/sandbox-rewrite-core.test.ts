import { describe, it, expect } from "vitest";
import {
  harvestOutput,
  isSandboxEmittingToolName,
  readContainerFileCitation,
  rewriteSandboxText,
  SANDBOX_PATTERN,
} from "./sandbox-rewrite-core";

describe("sandbox-rewrite-core", () => {
  describe("isSandboxEmittingToolName", () => {
    it.each([
      ["code_interpreter", true],
      ["image_generation", true],
      ["web_search_preview", false],
      ["search_documents", false],
      [undefined, false],
      ["", false],
    ])("name=%s → %s", (name, expected) => {
      expect(isSandboxEmittingToolName(name as string | undefined)).toBe(expected);
    });
  });

  describe("harvestOutput", () => {
    it("populates filename → url from image outputs with explicit filename", () => {
      const map = new Map<string, string>();
      harvestOutput(
        {
          outputs: [
            { type: "image", filename: "plot.png", url: "https://blob/plot.png" },
          ],
        },
        map,
      );
      expect(map.get("plot.png")).toBe("https://blob/plot.png");
    });

    it("derives filename from URL path when filename is missing", () => {
      const map = new Map<string, string>();
      harvestOutput(
        {
          outputs: [
            { type: "image", url: "https://blob/abc/derived.jpg?sig=xyz" },
          ],
        },
        map,
      );
      expect(map.get("derived.jpg")).toBe(
        "https://blob/abc/derived.jpg?sig=xyz",
      );
    });

    it("skips outputs whose URL is itself a sandbox URL", () => {
      const map = new Map<string, string>();
      harvestOutput(
        {
          outputs: [
            { type: "image", filename: "x.png", url: "sandbox:/mnt/data/x.png" },
          ],
        },
        map,
      );
      expect(map.size).toBe(0);
    });

    it("ignores non-image outputs", () => {
      const map = new Map<string, string>();
      harvestOutput(
        { outputs: [{ type: "logs", logs: "hello" }] },
        map,
      );
      expect(map.size).toBe(0);
    });

    it("no-ops on undefined / empty input", () => {
      const map = new Map<string, string>();
      harvestOutput(undefined, map);
      harvestOutput({ outputs: [] }, map);
      expect(map.size).toBe(0);
    });
  });

  describe("readContainerFileCitation", () => {
    it("reads the openai container_file_citation shape", () => {
      const out = readContainerFileCitation(
        {
          openai: {
            type: "container_file_citation",
            fileId: "file_abc",
            containerId: "ctr_xyz",
          },
        },
        "plot.png",
      );
      expect(out).toEqual({
        fileId: "file_abc",
        containerId: "ctr_xyz",
        filename: "plot.png",
      });
    });

    it("also accepts the metadata under the azure provider key", () => {
      const out = readContainerFileCitation(
        {
          azure: {
            type: "container_file_citation",
            fileId: "file_abc",
            containerId: "ctr_xyz",
          },
        },
        "plot.png",
      );
      expect(out?.fileId).toBe("file_abc");
    });

    it.each([
      ["missing filename", undefined, { openai: { type: "container_file_citation", fileId: "f", containerId: "c" } }],
      ["wrong annotation type", "plot.png", { openai: { type: "file_citation", fileId: "f", containerId: "c" } }],
      ["no provider key", "plot.png", { type: "container_file_citation", fileId: "f", containerId: "c" }],
      ["missing fileId", "plot.png", { openai: { type: "container_file_citation", containerId: "c" } }],
      ["missing containerId", "plot.png", { openai: { type: "container_file_citation", fileId: "f" } }],
      ["null meta", "plot.png", null],
    ])("returns null for %s", (_label, filename, meta) => {
      expect(readContainerFileCitation(meta, filename as string | undefined)).toBeNull();
    });
  });

  describe("rewriteSandboxText", () => {
    it("rewrites a single sandbox URL using the map", () => {
      const map = new Map<string, string>([["a.png", "https://b/a.png"]]);
      const out = rewriteSandboxText(
        "see ![](sandbox:/mnt/data/a.png) thanks",
        map,
      );
      expect(out).toBe("see ![](https://b/a.png) thanks");
    });

    it("rewrites multiple URLs and tracks unresolved separately", () => {
      const map = new Map<string, string>([["a.png", "https://b/a.png"]]);
      const unresolved: string[] = [];
      const out = rewriteSandboxText(
        "see ![](sandbox:/mnt/data/a.png) and ![](sandbox:/mnt/data/missing.jpg)",
        map,
        unresolved,
      );
      expect(out).toContain("https://b/a.png");
      expect(out).toContain("sandbox:/mnt/data/missing.jpg"); // left intact
      expect(unresolved).toEqual(["missing.jpg"]);
    });

    it("returns text by reference when there is nothing to rewrite", () => {
      const text = "plain prose with no sandbox urls";
      const out = rewriteSandboxText(text, new Map());
      expect(out).toBe(text);
    });

    it("global regex lastIndex does not leak between calls", () => {
      const map = new Map<string, string>([["a.png", "https://b/a.png"]]);
      const out1 = rewriteSandboxText("sandbox:/mnt/data/a.png", map);
      const out2 = rewriteSandboxText("sandbox:/mnt/data/a.png", map);
      expect(out1).toBe("https://b/a.png");
      expect(out2).toBe("https://b/a.png");
      // The exported pattern is the same global instance; verify lastIndex is reset.
      expect(SANDBOX_PATTERN.lastIndex).toBe(0);
    });
  });
});
