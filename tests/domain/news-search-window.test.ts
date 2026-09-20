import { describe, expect, it, vi } from "vitest";
import { DeepSeekWebSearchProvider, ExaSearchProvider } from "@/connectors/web-search";
import { normalizeNewsPublishedAt, publicationWindowForDay, isPublishedInWindow } from "@/domain/news-publication";
const publicationWindow = { start: "2026-09-03T16:00:00.000Z", end: "2026-09-04T16:00:00.000Z" };

describe("news publication dates", () => {
  it("uses Shanghai midnight at year and month boundaries", () => {
    expect(publicationWindowForDay("2026-12-31T16:01:00Z")).toEqual({ start: "2026-12-31T16:00:00.000Z", end: "2027-01-01T16:00:00.000Z" });
    expect(publicationWindowForDay("2026-09-04T15:59:59Z")).toEqual(publicationWindow);
    expect(() => publicationWindowForDay("invalid")).toThrow();
  });
  it.each([null, undefined, "", "today", "2026-02-30", "2026-09-04T10:00:00", "2026-09-04T90:00:00Z", "2026-13-04", "2026-09-03T24:00:00Z"])("fails closed on invalid or ambiguous date %s", value => {
    expect(normalizeNewsPublishedAt(value)).toBeNull();
    expect(isPublishedInWindow(value, publicationWindow)).toBe(false);
  });
  it("normalizes date-only as Shanghai and honors offset timestamps", () => {
    expect(normalizeNewsPublishedAt("2026-09-04")).toBe(publicationWindow.start);
    expect(normalizeNewsPublishedAt("2026-09-04T00:30:00+08:00")).toBe("2026-09-03T16:30:00.000Z");
    expect(isPublishedInWindow(publicationWindow.start, publicationWindow)).toBe(true);
    expect(isPublishedInWindow(publicationWindow.end, publicationWindow)).toBe(false);
  });
});

describe("provider publication filters", () => {
  it("sends publication dates, not crawl dates, to Exa", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [] }), { headers: { "content-type": "application/json" } }));
    await new ExaSearchProvider("fixture", fetchMock).search({ query: "融资新闻", limit: 5, publicationWindow, preferredDomains: ["chinaventure.com.cn", "36kr.com"] });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ startPublishedDate: publicationWindow.start, endPublishedDate: publicationWindow.end, includeDomains: ["chinaventure.com.cn", "36kr.com"] });
    expect(body).not.toHaveProperty("startCrawlDate");
  });
  it("instructs DeepSeek to verify original publication rather than infer today's date", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "new", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: '{"results":[]}' }] }] }), { headers: { "content-type": "application/json" } }));
    await new DeepSeekWebSearchProvider("fixture", fetchMock).search({ query: "融资新闻", limit: 5, publicationWindow, preferredDomains: ["chinaventure.com.cn", "36kr.com"] });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.input).toContain("2026-09-04");
    expect(body.input).toContain("Asia/Shanghai");
    expect(body.input).toContain("首次发布");
    expect(body.input).toContain("null");
    expect(body.input).toContain("chinaventure.com.cn");
    expect(body.input).toContain("36kr.com");
  });
});
