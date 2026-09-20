import { describe, expect, it, vi } from "vitest";
import { HttpFeedTransport, type FeedSourceConfiguration } from "@/connectors/syndication-feed";

const configuration: FeedSourceConfiguration = {
  sourceId: "source-live",
  endpointUrl: "https://feeds.example.cn/news.xml",
  allowedHostname: "feeds.example.cn",
  enabled: true,
  policyStatus: "approved",
  accessMode: "rss",
  timeoutMs: 10_000,
  maxResponseBytes: 2_097_152,
  maxItems: 200,
  etag: "old-etag",
  lastModified: null,
};

describe("safe HTTP feed transport", () => {
  it("uses conditional requests and parses an approved response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(`<rss><channel><title>Feed</title><item><guid>1</guid><title>半导体进展</title><link>https://feeds.example.cn/a</link><pubDate>Sun, 30 Aug 2026 01:00:00 GMT</pubDate><description>客户验证</description></item></channel></rss>`, {
      status: 200,
      headers: { "content-type": "application/rss+xml", etag: "new-etag" },
    }));
    const transport = new HttpFeedTransport(fetchMock, async () => ["93.184.216.34"]);

    const result = await transport.fetch(configuration);

    expect(result).toMatchObject({ kind: "fetched", etag: "new-etag", feed: { title: "Feed" } });
    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ headers: expect.objectContaining({ "if-none-match": "old-etag" }), redirect: "manual" }));
  });

  it("handles 304 without parsing a body", async () => {
    const transport = new HttpFeedTransport(vi.fn().mockResolvedValue(new Response(null, { status: 304, headers: { etag: "same" } })), async () => ["93.184.216.34"]);
    await expect(transport.fetch(configuration)).resolves.toMatchObject({ kind: "not_modified", httpStatus: 304, etag: "same" });
  });

  it("rejects private DNS, cross-host redirects, disallowed content and oversized bodies", async () => {
    const privateFetch = vi.fn();
    await expect(new HttpFeedTransport(privateFetch, async () => ["127.0.0.1"]).fetch(configuration)).rejects.toThrow(/public/i);
    expect(privateFetch).not.toHaveBeenCalled();

    const redirected = new HttpFeedTransport(vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://evil.example/feed" } })), async () => ["93.184.216.34"]);
    await expect(redirected.fetch(configuration)).rejects.toThrow(/hostname/i);

    const wrongType = new HttpFeedTransport(vi.fn().mockResolvedValue(new Response("hello", { status: 200, headers: { "content-type": "text/html" } })), async () => ["93.184.216.34"]);
    await expect(wrongType.fetch(configuration)).rejects.toThrow(/content type/i);

    const compressed = new HttpFeedTransport(vi.fn().mockResolvedValue(new Response("compressed", { status: 200, headers: { "content-type": "application/xml", "content-encoding": "gzip" } })), async () => ["93.184.216.34"]);
    await expect(compressed.fetch(configuration)).rejects.toThrow(/encoding/i);

    const oversized = new HttpFeedTransport(vi.fn().mockResolvedValue(new Response("0123456789", { status: 200, headers: { "content-type": "application/xml", "content-length": "10" } })), async () => ["93.184.216.34"]);
    await expect(oversized.fetch({ ...configuration, maxResponseBytes: 5 })).rejects.toThrow(/byte limit/i);
  });

  it("pins the production request to an address from the validated DNS result", async () => {
    const pinnedRequest = vi.fn().mockResolvedValue(new Response(null, { status: 304 }));
    const transport = new HttpFeedTransport(undefined, async () => ["93.184.216.34"], pinnedRequest);

    await transport.fetch(configuration);

    expect(pinnedRequest).toHaveBeenCalledOnce();
    const [url, headers, timeout, address] = pinnedRequest.mock.calls[0];
    expect(new URL(String(url)).hostname).toBe("feeds.example.cn");
    expect(headers).toEqual(expect.objectContaining({ "if-none-match": "old-etag" }));
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThanOrEqual(10_000);
    expect(address).toBe("93.184.216.34");
  });

  it("enforces one absolute deadline even while DNS resolution stalls", async () => {
    const transport = new HttpFeedTransport(undefined, () => new Promise(() => undefined));
    await expect(transport.fetch({ ...configuration, timeoutMs: 20 })).rejects.toThrow(/timed out/i);
  }, 500);
});
