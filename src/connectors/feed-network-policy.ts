import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

export function validateConfiguredFeedUrl(value: string, allowedHostname: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Feed URLs must use HTTPS.");
  if (url.username || url.password) throw new Error("Feed URLs must not contain credentials.");
  if (url.port && url.port !== "443") throw new Error("Feed URLs must use the approved HTTPS port.");
  if (isIP(url.hostname)) throw new Error("Feed URLs must not use an IP literal.");
  if (url.hostname.toLocaleLowerCase("en-US") !== allowedHostname.toLocaleLowerCase("en-US")) {
    throw new Error("Feed URL hostname is not approved.");
  }
  return url;
}

export function assertPublicAddresses(addresses: readonly string[]): void {
  if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
    throw new Error("Feed hostname must resolve only to public addresses.");
  }
}

function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.parse(address);
  if (parsed.kind() === "ipv6") {
    const ipv6 = parsed as ipaddr.IPv6;
    if (ipv6.isIPv4MappedAddress()) return ipv6.toIPv4Address().range() === "unicast";
  }
  return parsed.range() === "unicast";
}
