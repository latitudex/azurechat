import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Reject any URL that could be used to pivot inside the network or reach
 * the Azure Instance Metadata Service (IMDS). Extensions are user-authored
 * — without this guard any authenticated user can craft an extension whose
 * endpoint targets http://169.254.169.254/metadata/identity/... and
 * exfiltrate the managed-identity bearer token.
 *
 * Rules:
 *   1. Scheme MUST be https. http (and file:, gopher:, etc.) is rejected.
 *   2. Hostname is resolved; every resolved address MUST be a publicly
 *      routable unicast address. Private (RFC1918), link-local (169.254/16
 *      incl. IMDS, fe80::/10), loopback (127/8, ::1), unique-local
 *      (fc00::/7), and 0.0.0.0/8 / :: addresses are rejected.
 *   3. Literal IP hostnames must pass the same checks.
 *   4. Optional ALLOWED_EXTENSION_HOSTS env (comma-separated) is treated
 *      as the only legal host list. Empty/unset = "any public https host".
 *
 * Throws on any violation; returns the original url string on success.
 */
export async function assertExtensionUrlAllowed(rawUrl: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Extension endpoint is not a valid URL");
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`Extension endpoint must use https (got ${parsed.protocol})`);
  }

  const allowList = parseAllowList(process.env.ALLOWED_EXTENSION_HOSTS);
  if (allowList && !allowList.includes(parsed.hostname.toLowerCase())) {
    throw new Error(`Extension host ${parsed.hostname} is not in ALLOWED_EXTENSION_HOSTS`);
  }

  // Resolve hostname (or accept literal IPs) and check every address.
  const literalIpFamily = isIP(parsed.hostname);
  const addresses = literalIpFamily
    ? [{ address: parsed.hostname, family: literalIpFamily }]
    : await lookup(parsed.hostname, { all: true });

  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new Error(
        `Extension endpoint resolves to a non-public address (${address}) — refusing to send request`
      );
    }
  }

  return rawUrl;
}

function parseAllowList(raw: string | undefined): string[] | null {
  if (!raw || !raw.trim()) return null;
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Returns true if `address` is in a non-public range we must refuse to
 * contact. Covers the standard SSRF-mitigation set.
 */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isBlockedIPv4(address);
  if (family === 6) return isBlockedIPv6(address);
  // Unknown family → fail closed.
  return true;
}

function isBlockedIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true;
  }
  const [a, b] = parts;
  // 0.0.0.0/8 — current network
  if (a === 0) return true;
  // 10/8 — RFC1918
  if (a === 10) return true;
  // 100.64/10 — CGNAT
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127/8 — loopback
  if (a === 127) return true;
  // 169.254/16 — link-local (incl. Azure IMDS 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 172.16/12 — RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.0/24, 192.0.2/24 — IETF protocol assignments / TEST-NET-1
  if (a === 192 && b === 0) return true;
  // 192.168/16 — RFC1918
  if (a === 192 && b === 168) return true;
  // 198.18/15 — benchmarking
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 198.51.100/24 — TEST-NET-2
  if (a === 198 && b === 51) return true;
  // 203.0.113/24 — TEST-NET-3
  if (a === 203 && b === 0) return true;
  // 224/4 — multicast, 240/4 — reserved, 255.255.255.255 — broadcast
  if (a >= 224) return true;
  return false;
}

function isBlockedIPv6(rawAddress: string): boolean {
  // Strip zone id and lowercase.
  const address = rawAddress.split("%")[0].toLowerCase();
  // ::, ::1 — unspecified, loopback
  if (address === "::" || address === "::1") return true;
  // fe80::/10 — link-local
  if (address.startsWith("fe8") || address.startsWith("fe9") ||
      address.startsWith("fea") || address.startsWith("feb")) return true;
  // fc00::/7 — unique local
  if (address.startsWith("fc") || address.startsWith("fd")) return true;
  // ff00::/8 — multicast
  if (address.startsWith("ff")) return true;
  // IPv4-mapped (::ffff:a.b.c.d) — check the embedded v4
  const v4MappedMatch = address.match(/^::ffff:([0-9.]+)$/);
  if (v4MappedMatch) return isBlockedIPv4(v4MappedMatch[1]);
  return false;
}
