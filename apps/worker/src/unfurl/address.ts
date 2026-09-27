// Which addresses the unfurler may connect to (P-05). Anything that isn't a public
// unicast address is refused, so a pasted link can't reach our own network (SSRF).
import { BlockList, isIP } from "node:net";

// One list per family: a BlockList matches IPv4 addresses against IPv4-mapped IPv6 rules too.
const blocked4 = new BlockList();
const blocked6 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, including cloud metadata (169.254.169.254)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved and broadcast
] as const) {
  blocked4.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["::ffff:0:0", 96], // IPv4-mapped: could wrap any IPv4 address, including private ones
  ["64:ff9b::", 96], // NAT64, same reason
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard
  ["2001::", 23], // IETF protocol assignments, including Teredo
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4, can embed a private IPv4 address
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  blocked6.addSubnet(net, prefix, "ipv6");
}

const loopback = new BlockList();
loopback.addSubnet("127.0.0.0", 8, "ipv4");
loopback.addAddress("::1", "ipv6");

/**
 * `public`: only public unicast addresses (production).
 * `loopback-only`: only 127.0.0.0/8 and ::1, so tests unfurl from a local server and never reach the internet.
 */
export type AddressPolicy = "public" | "loopback-only";

export function isAllowedAddress(address: string, policy: AddressPolicy = "public"): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  const type = family === 4 ? "ipv4" : "ipv6";
  if (policy === "loopback-only") return loopback.check(address, type);
  return !(family === 4 ? blocked4 : blocked6).check(address, type);
}

/** `UNFURL_LOOPBACK_ONLY=1` switches tests to `loopback-only`; it's refused in production. */
export function addressPolicyFromEnv(env: Record<string, string | undefined>): AddressPolicy {
  if (env.UNFURL_LOOPBACK_ONLY !== "1") return "public";
  if (env.NODE_ENV === "production") throw new Error("UNFURL_LOOPBACK_ONLY is for tests and can't be set in production");
  return "loopback-only";
}
