import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { mockLookup } = vi.hoisted(() => ({ mockLookup: vi.fn() }));

vi.mock("node:dns/promises", () => ({
  default: { lookup: mockLookup },
  lookup: mockLookup,
}));

import {
  assertExtensionUrlAllowed,
  isBlockedAddress,
} from "./extension-url-guard";

describe("extension-url-guard", () => {
  beforeEach(() => {
    mockLookup.mockReset();
    delete process.env.ALLOWED_EXTENSION_HOSTS;
  });

  afterEach(() => {
    delete process.env.ALLOWED_EXTENSION_HOSTS;
  });

  describe("isBlockedAddress", () => {
    it.each([
      ["169.254.169.254", "Azure IMDS"],
      ["169.254.1.1", "link-local"],
      ["127.0.0.1", "loopback v4"],
      ["10.0.0.5", "RFC1918 10/8"],
      ["172.16.5.5", "RFC1918 172.16/12"],
      ["172.31.255.255", "RFC1918 172.31"],
      ["192.168.1.1", "RFC1918 192.168/16"],
      ["100.64.0.1", "CGNAT 100.64/10"],
      ["0.0.0.0", "current network 0.0.0.0/8"],
      ["224.0.0.1", "multicast"],
      ["255.255.255.255", "broadcast"],
      ["::1", "loopback v6"],
      ["::", "unspecified v6"],
      ["fe80::1", "link-local v6"],
      ["fc00::1", "ULA v6"],
      ["fd00::1", "ULA v6"],
      ["ff02::1", "multicast v6"],
      ["::ffff:169.254.169.254", "v4-mapped IMDS"],
      ["::ffff:127.0.0.1", "v4-mapped loopback"],
    ])("blocks %s (%s)", (addr) => {
      expect(isBlockedAddress(addr)).toBe(true);
    });

    it.each([
      ["8.8.8.8"],
      ["1.1.1.1"],
      ["172.32.0.1"], // just outside RFC1918
      ["172.15.255.255"], // just outside RFC1918
      ["100.128.0.1"], // just outside CGNAT
      ["2001:4860:4860::8888"], // public IPv6
    ])("allows public %s", (addr) => {
      expect(isBlockedAddress(addr)).toBe(false);
    });
  });

  describe("assertExtensionUrlAllowed", () => {
    it("rejects http scheme", async () => {
      await expect(
        assertExtensionUrlAllowed("http://example.com/api"),
      ).rejects.toThrow(/must use https/);
    });

    it("rejects file scheme", async () => {
      await expect(
        assertExtensionUrlAllowed("file:///etc/passwd"),
      ).rejects.toThrow(/must use https/);
    });

    it("rejects malformed URL", async () => {
      await expect(
        assertExtensionUrlAllowed("not a url"),
      ).rejects.toThrow(/not a valid URL/);
    });

    it("rejects literal IMDS IP", async () => {
      await expect(
        assertExtensionUrlAllowed("https://169.254.169.254/metadata"),
      ).rejects.toThrow(/non-public address/);
    });

    it("rejects DNS-resolved private IP", async () => {
      mockLookup.mockResolvedValue([
        { address: "10.0.0.1", family: 4 },
      ] as never);
      await expect(
        assertExtensionUrlAllowed("https://internal.example/api"),
      ).rejects.toThrow(/non-public address/);
    });

    it("rejects DNS rebinding (one of multiple addresses is private)", async () => {
      mockLookup.mockResolvedValue([
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ] as never);
      await expect(
        assertExtensionUrlAllowed("https://evil.example/api"),
      ).rejects.toThrow(/non-public address/);
    });

    it("allows public DNS-resolved host", async () => {
      mockLookup.mockResolvedValue([
        { address: "8.8.8.8", family: 4 },
      ] as never);
      await expect(
        assertExtensionUrlAllowed("https://api.example.com/path?x=1"),
      ).resolves.toBe("https://api.example.com/path?x=1");
    });

    it("enforces ALLOWED_EXTENSION_HOSTS when set", async () => {
      process.env.ALLOWED_EXTENSION_HOSTS = "api.example.com,other.example.com";
      mockLookup.mockResolvedValue([
        { address: "8.8.8.8", family: 4 },
      ] as never);

      await expect(
        assertExtensionUrlAllowed("https://api.example.com/foo"),
      ).resolves.toBe("https://api.example.com/foo");

      await expect(
        assertExtensionUrlAllowed("https://evil.example.com/foo"),
      ).rejects.toThrow(/ALLOWED_EXTENSION_HOSTS/);
    });
  });
});
