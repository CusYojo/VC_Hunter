import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { normalizeNewsPublishedAt } from "@/domain/news-publication";
import { assertPublicAddresses, validateConfiguredFeedUrl } from "./feed-network-policy";

const MAX_BYTES = 1_048_576;
type PinnedRequest = (url: URL, address: string, timeoutMs: number) => Promise<Response>;
interface VerifierOptions {
  resolveHostname?: (hostname: string) => Promise<readonly string[]>;
  request?: PinnedRequest;
  timeoutMs?: number;
}

/** The model's dates are never evidence: inaccessible or ambiguous originals are excluded. */
export async function verifyNewsPublication(url: string): Promise<string | null> {
  return new NewsPublicationVerifier().verify(url);
}

export class NewsPublicationVerifier {
  constructor(private readonly options: VerifierOptions = {}) {}

  async verify(rawUrl: string): Promise<string | null> {
    const deadline = Date.now() + Math.min(8_000, Math.max(1, this.options.timeoutMs ?? 8_000));
    const resolveHostname = this.options.resolveHostname ?? (async (hostname: string) => (await lookup(hostname, { all: true, verbatim: true })).map(item => item.address));
    try {
      let url = validatedUrl(rawUrl);
      for (let redirects = 0; redirects <= 2; redirects += 1) {
        const addresses = await bounded(resolveHostname(url.hostname), deadline);
        assertPublicAddresses(addresses);
        const response = await bounded((this.options.request ?? pinnedRequest)(url, addresses[0], remaining(deadline)), deadline);
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          void response.body?.cancel().catch(() => undefined);
          if (!location || redirects === 2) return null;
          url = validatedUrl(new URL(location, url).toString());
          continue;
        }
        const type = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
        const encoding = response.headers.get("content-encoding")?.trim().toLowerCase();
        if (!response.ok || !["text/html", "application/xhtml+xml"].includes(type ?? "") || (encoding && encoding !== "identity")) {
          void response.body?.cancel().catch(() => undefined);
          return null;
        }
        return extractNewsPublication(await limitedHtml(response, deadline), url.toString());
      }
    } catch { return null; }
    return null;
  }
}

function validatedUrl(value: string): URL {
  const url = new URL(value);
  if (isIP(url.hostname.replace(/^\[|\]$/g, ""))) throw new Error("IP literals are not allowed.");
  // Reuse the feed's strict scheme, port, literal and credential checks; each redirect is revalidated.
  return validateConfiguredFeedUrl(value, url.hostname);
}

function remaining(deadline: number): number {
  const milliseconds = deadline - Date.now();
  if (milliseconds <= 0) throw new Error("Article verification timed out.");
  return milliseconds;
}

function bounded<T>(operation: Promise<T>, deadline: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Article verification timed out.")), remaining(deadline));
    operation.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

async function limitedHtml(response: Response, deadline: number): Promise<string> {
  if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error("Article exceeds byte limit.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await bounded(reader.read(), deadline);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error("Article exceeds byte limit.");
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
}

function pinnedRequest(url: URL, address: string, timeoutMs: number): Promise<Response> {
  return new Promise((resolve, reject) => {
    let incomingResponse: import("node:http").IncomingMessage | undefined;
    const outgoing = httpsRequest({ hostname: address, port: 443, method: "GET", path: `${url.pathname}${url.search}`, servername: url.hostname,
      headers: { host: url.host, accept: "text/html, application/xhtml+xml", "accept-encoding": "identity", "user-agent": "VC-Hunter-NewsVerifier/1.0" } }, incoming => {
      incomingResponse = incoming;
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      const status = incoming.statusCode ?? 502;
      const noBody = [204, 205, 304].includes(status);
      if (noBody) { clearTimeout(timer); incoming.resume(); }
      else incoming.once("close", () => clearTimeout(timer));
      resolve(new Response(noBody ? null : Readable.toWeb(incoming) as ReadableStream<Uint8Array>, { status, headers }));
    });
    const timer = setTimeout(() => { const error = new Error("Article verification timed out."); incomingResponse?.destroy(error); outgoing.destroy(error); }, timeoutMs);
    outgoing.once("error", error => { clearTimeout(timer); reject(error); });
    outgoing.end();
  });
}

/** A deliberately narrow metadata reader. No scripts execute, and unrelated graph nodes cannot date this page. */
export function extractNewsPublication(html: string, pageUrl: string): string | null {
  if (Buffer.byteLength(html) > MAX_BYTES) return null;
  const clean = html.replace(/<!--[\s\S]*?(?:-->|$)/g, "").replace(/<(template|noscript|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const dates: unknown[] = [];
  for (const script of clean.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = attributes(script[1]);
    if (attrs?.type?.toLowerCase() !== "application/ld+json") continue;
    try { collectArticleDates(JSON.parse(script[2]), pageUrl, dates, 0); } catch { /* Other broken graph blocks cannot supply publication evidence. */ }
  }
  const withoutScripts = clean.replace(/<script\b[^>]*>[\s\S]*?(?:<\/script\s*>|$)/gi, "");
  for (const tag of withoutScripts.matchAll(/<meta\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)) {
    const attrs = attributes(tag[1]);
    if (!attrs) return null;
    if ((attrs.property ?? attrs.name)?.toLowerCase() === "article:published_time") dates.push(attrs.content);
  }
  const publisher = publisherDate(clean, pageUrl);
  if (publisher.invalid) return null;
  if (publisher.date) dates.push(publisher.date);
  const normalized = dates.map(value => normalizeNewsPublishedAt(typeof value === "string" ? value : null));
  if (!normalized.length || normalized.some(value => value === null)) return null;
  return new Set(normalized).size === 1 ? normalized[0] : null;
}

function attributes(source: string): Record<string, string> | null {
  const entries: Array<[string, string]> = [];
  for (const match of source.matchAll(/([^\s=/'"<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s'"=<>`]+))/g)) {
    const key = match[1].toLowerCase();
    if (entries.some(([existing]) => existing === key)) return null;
    entries.push([key, decodeEntities(match[2] ?? match[3] ?? match[4])]);
  }
  return Object.fromEntries(entries);
}

function decodeEntities(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|(amp|quot|apos|lt|gt));/gi, (whole, decimal: string, hex: string, name: string) => {
    if (decimal || hex) { const code = parseInt(decimal || hex, decimal ? 10 : 16); return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole; }
    return ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" } as Record<string, string>)[name.toLowerCase()];
  });
}

function collectArticleDates(node: unknown, pageUrl: string, dates: unknown[], depth: number): void {
  if (depth > 12 || !node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const child of node.slice(0, 200)) collectArticleDates(child, pageUrl, dates, depth + 1); return; }
  const item = node as Record<string, unknown>;
  const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
  const page = item.mainEntityOfPage;
  const identity = typeof page === "object" && page ? (page as Record<string, unknown>)["@id"] : page;
  if (types.some(type => type === "NewsArticle" || type === "Article") && [item.url, item["@id"], identity].some(value => samePage(value, pageUrl)) && "datePublished" in item) dates.push(item.datePublished);
  // Only graph containers, not related-article/recommendation properties.
  for (const key of ["@graph", "mainEntity"]) if (item[key]) collectArticleDates(item[key], pageUrl, dates, depth + 1);
}

function samePage(value: unknown, pageUrl: string): boolean {
  if (typeof value !== "string") return false;
  try { const candidate = new URL(value, pageUrl); const page = new URL(pageUrl); candidate.hash = ""; page.hash = ""; return candidate.toString() === page.toString(); } catch { return false; }
}


function publisherDate(html: string, pageUrl: string): { date?: string; invalid?: boolean } {
  const page = new URL(pageUrl);
  if (page.hostname === "36kr.com" || page.hostname.endsWith(".36kr.com")) {
    const id = page.pathname.match(/\/(?:newsflashes|p)\/(\d+)\/?$/)?.[1];
    if (!id) return {};
    for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
      const state = script[1].match(/^\s*window\.initialState\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
      if (!state) continue;
      try {
        const article = JSON.parse(state[1]).articleDetailData;
        if (!article || String(article.itemId) !== id || !Number.isSafeInteger(article.publishTime) || article.publishTime <= 0) return { invalid: true };
        const date = new Date(article.publishTime).toISOString();
        const header = html.match(/<span\b[^>]*class=["'][^"']*\bitem-time\b[^"']*["'][^>]*>\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?)\s*<\/span>/i)?.[1];
        if (header) {
          const corroboration = normalizeNewsPublishedAt(`${header.replace(" ", "T")}+08:00`);
          if (!corroboration || corroboration.slice(0, 16) !== date.slice(0, 16)) return { invalid: true };
        }
        return { date };
      } catch { return { invalid: true }; }
    }
  }
  if (page.hostname === "chinaventure.com.cn" || page.hostname === "www.chinaventure.com.cn") {
    const id = page.pathname.match(/^\/news\/\d+-\d{8}-(\d+)\.html$/)?.[1];
    if (!id || !/<h1\b[^>]*class=["'][^"']*\bmaintitle_pc\b/i.test(html)) return {};
    const articleId = [...html.matchAll(/<input\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)].map(tag => attributes(tag[1])).find(attrs => attrs?.id === "articleId")?.value;
    if (articleId !== id) return { invalid: true };
    const header = html.match(/<div\b[^>]*class=["']releaseTime["'][^>]*>\s*<span>\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*<\/span>\s*<\/div>/i)?.[1];
    return header ? { date: `${header.replace(" ", "T")}+08:00` } : {};
  }
  return {};
}
