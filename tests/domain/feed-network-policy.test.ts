import { describe, expect, it } from "vitest";
import { assertPublicAddresses, validateConfiguredFeedUrl } from "@/connectors/feed-network-policy";

describe("feed network policy", () => {
  it("only accepts an exact approved HTTPS hostname", () => {
    expect(validateConfiguredFeedUrl("https://feeds.example.cn/news.xml", "feeds.example.cn").hostname).toBe("feeds.example.cn");
    expect(() => validateConfiguredFeedUrl("http://feeds.example.cn/news.xml", "feeds.example.cn")).toThrow(/https/i);
    expect(() => validateConfiguredFeedUrl("https://user:pass@feeds.example.cn/news.xml", "feeds.example.cn")).toThrow(/credentials/i);
    expect(() => validateConfiguredFeedUrl("https://evil.example/news.xml", "feeds.example.cn")).toThrow(/hostname/i);
    expect(() => validateConfiguredFeedUrl("https://127.0.0.1/news.xml", "127.0.0.1")).toThrow(/literal/i);
  });

  it("rejects private, loopback, link-local and metadata DNS results", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.8", "::1", "::ffff:7f00:1", "2001:db8::1", "fc00::1", "fe80::1"]) {
      expect(() => assertPublicAddresses([address])).toThrow(/public/i);
    }
    expect(() => assertPublicAddresses(["93.184.216.34"])).not.toThrow();
  });
});
