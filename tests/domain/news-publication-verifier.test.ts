import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { describe, expect, it, vi } from "vitest";
import { NewsPublicationVerifier, extractNewsPublication, verifyNewsPublication } from "@/connectors/news-publication-verifier";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("node:https", () => ({ request: vi.fn() }));

const url = "https://news.example.cn/article/123";
const stamp = "2026-09-04T08:15:00+08:00";
const iso = "2026-09-04T00:15:00.000Z";
const meta = `<meta property="article:published_time" content="${stamp}">`;
const html = (body = meta, headers: Record<string, string> = {}) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8", ...headers } });
const publicDns = async () => ["93.184.216.34"];

describe("original article publication metadata", () => {
  it("reads published metadata in either attribute order and decodes entities", () => {
    expect(extractNewsPublication(meta, url)).toBe(iso);
    expect(extractNewsPublication(`<META content='2026-09-04T08:15:00&#43;08:00' PROPERTY='article:published_time'>`, url)).toBe(iso);
  });
  it("reads only JSON-LD articles identifying this page, including graph nodes", () => {
    const nodes = { "@graph": [{ "@type": "NewsArticle", url, datePublished: stamp, dateModified: "2026-09-05" }] };
    expect(extractNewsPublication(`<script type="application/ld+json">${JSON.stringify(nodes)}</script>`, url)).toBe(iso);
    expect(extractNewsPublication(`<script type="application/ld+json">${JSON.stringify({ "@type": ["Thing", "Article"], mainEntityOfPage: { "@id": url }, datePublished: stamp })}</script>`, url)).toBe(iso);
  });
  it("never uses modified dates, unrelated articles, generic dates, comments or script strings", () => {
    for (const body of [
      `<meta property="article:modified_time" content="${stamp}"><time datetime="${stamp}">今天</time>`,
      `<script type="application/ld+json">${JSON.stringify({ "@type": "NewsArticle", url: `${url}/related`, datePublished: stamp })}</script>`,
      `<script type="application/ld+json">${JSON.stringify({ "@type": "NewsArticle", datePublished: stamp })}</script>`,
      `<script>const pretend = '${meta}'</script>`, `<!-- ${meta} -->`, `<template>${meta}</template>`,
    ]) expect(extractNewsPublication(body, url)).toBeNull();
  });
  it("rejects conflicting, malformed and ambiguous publication evidence", () => {
    for (const body of [meta + `<meta property="article:published_time" content="2020-01-01">`, meta + `<meta property="article:published_time" content="yesterday">`, `<meta property="article:published_time" content="2026-09-04T08:15:00">`, `<script type="application/ld+json">{broken}</script>`, `<meta property="article:published_time" property="untrusted" content="${stamp}">`]) expect(extractNewsPublication(body, url)).toBeNull();
    expect(extractNewsPublication(`<meta property="article:published_time" content="2026-09-04">`, url)).toBe("2026-09-03T16:00:00.000Z");
  });
  it("recognizes publisher-specific current-article timestamps for 36kr and 投中网", () => {
    const krUrl = "https://eu.36kr.com/zh/newsflashes/3968724365783558";
    const kr = `<h1 class="article-title zh">融资新闻</h1><span class="title-icon-item item-time">2026-09-04 14:46</span><script>window.initialState={"articleDetailData":{"itemId":3968724365783558,"publishTime":1788504367000}}</script>`;
    expect(extractNewsPublication(kr, krUrl)).toBe("2026-09-04T06:46:07.000Z");
    expect(extractNewsPublication(kr, krUrl.replace("3558", "3559"))).toBeNull();
    expect(extractNewsPublication(kr, "https://attacker.example/article")).toBeNull();
    const cv = `<h1 class="maintitle_pc">项目新闻</h1><div class="author_keyword clearfix"><div class="releaseTime"><span>2026-09-04 10:44:27</span></div><input id="articleId" type="hidden" value="393104"></div>`;
    expect(extractNewsPublication(cv, "https://www.chinaventure.com.cn/news/80-20260904-393104.html")).toBe("2026-09-04T02:44:27.000Z");
    expect(extractNewsPublication(cv, "https://www.chinaventure.com.cn/news/80-20260904-393105.html")).toBeNull();
    expect(extractNewsPublication(kr.replace("14:46</span>", "14:47</span>"), krUrl)).toBeNull();
  });

});

describe("safe original article verification", () => {
  it("pins transport to a public DNS address and bounds time", async () => {
    const transport = vi.fn().mockResolvedValue(html());
    await expect(new NewsPublicationVerifier({ resolveHostname: publicDns, request: transport }).verify(url)).resolves.toBe(iso);
    expect(transport).toHaveBeenCalledWith(expect.any(URL), "93.184.216.34", expect.any(Number));
    expect(transport.mock.calls[0][2]).toBeLessThanOrEqual(8_000);
  });
  it("fails closed on unsafe URLs, DNS, mixed DNS and lookup errors", async () => {
    const transport = vi.fn();
    for (const unsafe of ["http://news.example.cn/a", "https://u:p@news.example.cn/a", "https://127.0.0.1/a", "https://[::1]/a", "https://news.example.cn:444/a", "not a url"]) {
      expect(await new NewsPublicationVerifier({ resolveHostname: publicDns, request: transport }).verify(unsafe)).toBeNull();
    }
    for (const addresses of [[], ["127.0.0.1"], ["93.184.216.34", "10.0.0.1"], ["::ffff:127.0.0.1"]]) expect(await new NewsPublicationVerifier({ resolveHostname: async () => addresses, request: transport }).verify(url)).toBeNull();
    expect(await new NewsPublicationVerifier({ resolveHostname: async () => { throw Error("private failure"); }, request: transport }).verify(url)).toBeNull();
    expect(transport).not.toHaveBeenCalled();
  });
  it("validates every redirect, allowing at most two", async () => {
    const transport = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/redirected" } })).mockResolvedValueOnce(html());
    expect(await new NewsPublicationVerifier({ resolveHostname: publicDns, request: transport }).verify(url)).toBe(iso);
    const privateRedirect = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://internal.example.cn/secret" } }));
    expect(await new NewsPublicationVerifier({ resolveHostname: async host => host === "internal.example.cn" ? ["10.0.0.1"] : ["93.184.216.34"], request: privateRedirect }).verify(url)).toBeNull();
    expect(privateRedirect).toHaveBeenCalledTimes(1);
    const loop = vi.fn().mockImplementation(async () => new Response(null, { status: 301, headers: { location: url } }));
    expect(await new NewsPublicationVerifier({ resolveHostname: publicDns, request: loop }).verify(url)).toBeNull();
    expect(loop).toHaveBeenCalledTimes(3);
  });
  it("rejects bad responses and oversized declared or streamed bodies", async () => {
    const responses = [new Response("no", { status: 403 }), html(meta, { "content-type": "application/pdf" }), html(meta, { "content-encoding": "gzip" }), html(meta, { "content-length": "1048577" }), html("x".repeat(1048577)), new Response(null, { status: 302 }), new Response(null, { status: 204 })];
    for (const response of responses) expect(await new NewsPublicationVerifier({ resolveHostname: publicDns, request: async () => response }).verify(url)).toBeNull();
    expect(await new NewsPublicationVerifier({ resolveHostname: publicDns, request: async () => { throw Error("network"); } }).verify(url)).toBeNull();
  });
  it("enforces an absolute timeout for stuck DNS and bodies", async () => {
    expect(await new NewsPublicationVerifier({ timeoutMs: 15, resolveHostname: () => new Promise(() => undefined) }).verify(url)).toBeNull();
    const response = new Response(new ReadableStream({ pull() { return new Promise(() => undefined); } }), { headers: { "content-type": "text/html" } });
    expect(await new NewsPublicationVerifier({ timeoutMs: 15, resolveHostname: publicDns, request: async () => response }).verify(url)).toBeNull();
  });
});


describe("production pinned transport", () => {
  it("connects to the validated IP with the original TLS hostname and no credentials", async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
    const transport = vi.mocked(httpsRequest);
    transport.mockImplementation(((options: Record<string, unknown>, callback: (response: unknown) => void) => {
      const outgoing = new EventEmitter() as EventEmitter & { end: () => void; destroy: (error: Error) => void };
      outgoing.end = () => queueMicrotask(() => {
        const incoming = Object.assign(new PassThrough(), { headers: { "content-type": "text/html", "x-sample": ["a", "b"] }, statusCode: 200 });
        callback(incoming);
        incoming.end(meta);
      });
      outgoing.destroy = error => { outgoing.emit("error", error); };
      return outgoing;
    }) as never);
    await expect(verifyNewsPublication(url)).resolves.toBe(iso);
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({ hostname: "93.184.216.34", port: 443, servername: "news.example.cn", path: "/article/123", headers: expect.objectContaining({ host: "news.example.cn", "accept-encoding": "identity" }) }), expect.any(Function));
  });
  it("handles default transport errors and destroys a stalled socket within the deadline", async () => {
    let destroyed = false;
    vi.mocked(httpsRequest).mockImplementation((() => {
      const outgoing = new EventEmitter() as EventEmitter & { end: () => void; destroy: (error: Error) => void };
      outgoing.end = () => undefined;
      outgoing.destroy = error => { destroyed = true; outgoing.emit("error", error); };
      return outgoing;
    }) as never);
    expect(await new NewsPublicationVerifier({ resolveHostname: publicDns, timeoutMs: 15 }).verify(url)).toBeNull();
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(destroyed).toBe(true);
  });
});
