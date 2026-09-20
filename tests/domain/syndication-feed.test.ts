import { describe, expect, it } from "vitest";
import { parseSyndicationFeed } from "@/connectors/syndication-feed";

describe("syndication feed parser", () => {
  it("normalizes RSS 2.0 items and strips embedded markup", () => {
    const feed = parseSyndicationFeed(`<?xml version="1.0"?>
      <rss version="2.0"><channel><title>Demo</title>
        <item><guid>item-1</guid><title>芯片进展</title><link>https://news.example.cn/a</link>
        <pubDate>Sun, 30 Aug 2026 01:00:00 GMT</pubDate><description><![CDATA[<p>完成 <b>客户验证</b></p>]]></description></item>
      </channel></rss>`, { maxItems: 20 });

    expect(feed.title).toBe("Demo");
    expect(feed.items).toEqual([expect.objectContaining({
      externalId: "item-1",
      title: "芯片进展",
      canonicalUrl: "https://news.example.cn/a",
      publishedAt: "2026-08-30T01:00:00.000Z",
      excerpt: "完成 客户验证",
    })]);
  });

  it("normalizes Atom entries and enforces the item limit", () => {
    const feed = parseSyndicationFeed(`<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Demo</title>
        <entry><id>tag:example,1</id><title>机器人原型</title><link rel="alternate" href="https://robot.example.cn/1"/><updated>2026-08-30T02:00:00Z</updated><summary>完成集成原型</summary></entry>
        <entry><id>tag:example,2</id><title>第二条</title><link href="https://robot.example.cn/2"/><updated>2026-08-30T03:00:00Z</updated><summary>第二条</summary></entry>
      </feed>`, { maxItems: 1 });

    expect(feed.title).toBe("Atom Demo");
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]).toMatchObject({ externalId: "tag:example,1", canonicalUrl: "https://robot.example.cn/1" });
  });

  it("rejects DTD/entity input and entries without trustworthy time or URL", () => {
    expect(() => parseSyndicationFeed("<!DOCTYPE rss [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><rss></rss>", { maxItems: 20 })).toThrow(/doctype|entity/i);

    const feed = parseSyndicationFeed(`<rss><channel><item><guid>x</guid><title>missing</title></item></channel></rss>`, { maxItems: 20 });
    expect(feed.items).toHaveLength(0);
  });
});
