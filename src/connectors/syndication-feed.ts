import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { Readable } from "node:stream";
import { XMLParser } from "fast-xml-parser";
import { assertPublicAddresses, validateConfiguredFeedUrl } from "./feed-network-policy";

export interface FeedItem {
  externalId: string;
  title: string;
  canonicalUrl: string;
  publishedAt: string;
  excerpt: string;
}

export interface ParsedFeed {
  title: string;
  items: FeedItem[];
}

export interface FeedSourceConfiguration {
  sourceId: string;
  endpointUrl: string;
  allowedHostname: string;
  enabled: boolean;
  policyStatus: string;
  accessMode: string;
  timeoutMs: number;
  maxResponseBytes: number;
  maxItems: number;
  etag: string | null;
  lastModified: string | null;
}

export type FeedFetchResult =
  | { kind: "not_modified"; httpStatus: 304; finalUrl: string; etag: string | null; lastModified: string | null }
  | { kind: "fetched"; httpStatus: number; finalUrl: string; contentType: string; rawBody: string; etag: string | null; lastModified: string | null; feed: ParsedFeed };

export interface FeedTransport {
  fetch(configuration: FeedSourceConfiguration): Promise<FeedFetchResult>;
}

type PinnedRequest = (url: URL, headers: Readonly<Record<string, string>>, timeoutMs: number, address: string) => Promise<Response>;

export function parseSyndicationFeed(xml: string, options: { maxItems: number }): ParsedFeed {
  if (/<!\s*(doctype|entity)\b/i.test(xml)) throw new Error("DOCTYPE and ENTITY declarations are not allowed.");
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    textNodeName: "#text",
    cdataPropName: "#cdata",
    processEntities: false,
    trimValues: true,
    parseTagValue: false,
  });
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const rssChannel = objectValue(objectValue(parsed.rss)?.channel);
  const atomFeed = objectValue(parsed.feed);
  if (rssChannel) {
    const items = arrayValue(rssChannel.item).map(parseRssItem).filter(isFeedItem).slice(0, options.maxItems);
    return { title: plainText(rssChannel.title), items };
  }
  if (atomFeed) {
    const items = arrayValue(atomFeed.entry).map(parseAtomEntry).filter(isFeedItem).slice(0, options.maxItems);
    return { title: plainText(atomFeed.title), items };
  }
  throw new Error("Unsupported RSS or Atom document.");
}

export class HttpFeedTransport implements FeedTransport {
  constructor(
    private readonly fetchImpl: typeof fetch | undefined = undefined,
    private readonly resolveHostname: (hostname: string) => Promise<readonly string[]> = async (hostname) => (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address),
    private readonly pinnedRequest: PinnedRequest = fetchPinnedHttps,
  ) {}

  async fetch(configuration: FeedSourceConfiguration): Promise<FeedFetchResult> {
    const deadlineAt = Date.now() + configuration.timeoutMs;
    let url = validateConfiguredFeedUrl(configuration.endpointUrl, configuration.allowedHostname);
    const headers: Record<string, string> = { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml", "accept-encoding": "identity", "user-agent": "VC-Hunter-SourceOps/0.1" };
    if (configuration.etag) headers["if-none-match"] = configuration.etag;
    if (configuration.lastModified) headers["if-modified-since"] = configuration.lastModified;

    for (let redirect = 0; redirect <= 3; redirect += 1) {
      const addresses = await beforeDeadline(this.resolveHostname(url.hostname), deadlineAt);
      assertPublicAddresses(addresses);
      const remaining = remainingMilliseconds(deadlineAt);
      const response = this.fetchImpl
        ? await this.fetchImpl(url, { headers, redirect: "manual", signal: AbortSignal.timeout(remaining) })
        : await this.pinnedRequest(url, headers, remaining, addresses[0]);
      if (response.status >= 300 && response.status < 400 && response.status !== 304) {
        const location = response.headers.get("location");
        if (!location || redirect === 3) throw new Error("Feed redirect policy rejected the response.");
        await response.body?.cancel();
        url = validateConfiguredFeedUrl(new URL(location, url).toString(), configuration.allowedHostname);
        continue;
      }
      const metadata = { finalUrl: url.toString(), etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified") };
      if (response.status === 304) return { kind: "not_modified", httpStatus: 304, ...metadata };
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Feed returned HTTP ${response.status}.`);
      }
      const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLocaleLowerCase("en-US") ?? "";
      if (!new Set(["application/rss+xml", "application/atom+xml", "application/xml", "text/xml"]).has(contentType)) {
        await response.body?.cancel();
        throw new Error("Feed content type is not allowed.");
      }
      const contentEncoding = response.headers.get("content-encoding")?.trim().toLocaleLowerCase("en-US");
      if (contentEncoding && contentEncoding !== "identity") {
        await response.body?.cancel();
        throw new Error("Feed content encoding is not allowed.");
      }
      const body = await readLimitedBody(response, configuration.maxResponseBytes, deadlineAt);
      return { kind: "fetched", httpStatus: response.status, contentType, rawBody: body, feed: parseSyndicationFeed(body, { maxItems: configuration.maxItems }), ...metadata };
    }
    throw new Error("Feed redirect policy rejected the response.");
  }
}

function fetchPinnedHttps(url: URL, headers: Readonly<Record<string, string>>, timeoutMs: number, address: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    let incomingResponse: import("node:http").IncomingMessage | undefined;
    const outgoing = request({
      protocol: "https:",
      hostname: address,
      port: url.port || 443,
      method: "GET",
      path: `${url.pathname}${url.search}`,
      servername: url.hostname,
      headers: { ...headers, host: url.host },
    }, (incoming) => {
      incomingResponse = incoming;
      const status = incoming.statusCode ?? 502;
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) responseHeaders.set(name, value.join(", "));
        else if (value !== undefined) responseHeaders.set(name, value);
      }
      const hasNoBody = status === 204 || status === 205 || status === 304;
      const body = hasNoBody ? null : Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
      if (hasNoBody) clearTimeout(deadlineTimer);
      else incoming.once("close", () => clearTimeout(deadlineTimer));
      resolve(new Response(body, { status, statusText: incoming.statusMessage, headers: responseHeaders }));
    });
    const deadlineTimer = setTimeout(() => {
      const error = new Error("Feed request timed out.");
      incomingResponse?.destroy(error);
      outgoing.destroy(error);
    }, timeoutMs);
    outgoing.once("error", reject);
    outgoing.end();
  });
}

async function readLimitedBody(response: Response, maximumBytes: number, deadlineAt: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maximumBytes) throw new Error("Feed response exceeds the configured byte limit.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await beforeDeadline(reader.read(), deadlineAt).catch(async (error) => { await reader.cancel().catch(() => undefined); throw error; });
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new Error("Feed response exceeds the configured byte limit.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function remainingMilliseconds(deadlineAt: number): number {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw new Error("Feed request timed out.");
  return remaining;
}

function beforeDeadline<T>(operation: Promise<T>, deadlineAt: number): Promise<T> {
  const remaining = remainingMilliseconds(deadlineAt);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Feed request timed out.")), remaining);
    operation.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

function parseRssItem(value: unknown): FeedItem | null {
  const item = objectValue(value);
  if (!item) return null;
  return buildFeedItem({ externalId: plainText(item.guid) || plainText(item.link), title: plainText(item.title), url: plainText(item.link), date: plainText(item.pubDate) || plainText(item["dc:date"]), excerpt: plainText(item.description) || plainText(item["content:encoded"]) });
}

function parseAtomEntry(value: unknown): FeedItem | null {
  const entry = objectValue(value);
  if (!entry) return null;
  const links = arrayValue(entry.link).map(objectValue).filter((link): link is Record<string, unknown> => Boolean(link));
  const alternate = links.find((link) => !link["@rel"] || link["@rel"] === "alternate") ?? links[0];
  return buildFeedItem({ externalId: plainText(entry.id), title: plainText(entry.title), url: plainText(alternate?.["@href"]) || plainText(entry.link), date: plainText(entry.published) || plainText(entry.updated), excerpt: plainText(entry.summary) || plainText(entry.content) });
}

function buildFeedItem(input: { externalId: string; title: string; url: string; date: string; excerpt: string }): FeedItem | null {
  const timestamp = Date.parse(input.date);
  if (!input.title || !input.url || !Number.isFinite(timestamp)) return null;
  let canonicalUrl: URL;
  try { canonicalUrl = new URL(input.url); } catch { return null; }
  if (!new Set(["https:", "http:"]).has(canonicalUrl.protocol)) return null;
  return { externalId: input.externalId || canonicalUrl.toString(), title: limit(input.title, 500), canonicalUrl: canonicalUrl.toString(), publishedAt: new Date(timestamp).toISOString(), excerpt: limit(input.excerpt || input.title, 10_000) };
}

function plainText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return stripMarkup(String(value));
  const object = objectValue(value);
  if (!object) return "";
  return stripMarkup([object["#text"], object["#cdata"]].map((part) => typeof part === "string" ? part : "").filter(Boolean).join(" "));
}

function stripMarkup(value: string): string {
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function limit(value: string, maximum: number): string { return value.length > maximum ? value.slice(0, maximum) : value; }
function objectValue(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function arrayValue(value: unknown): unknown[] { return value === undefined ? [] : Array.isArray(value) ? value : [value]; }
function isFeedItem(value: FeedItem | null): value is FeedItem { return value !== null; }
