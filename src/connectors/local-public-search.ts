import type { DatabaseSync } from "node:sqlite";
import { isIP } from "node:net";
import type { WebSearchProvider, WebSearchResponse, WebSearchResult, WebSearchInput } from "./web-search";
import { SOURCE_MAY_USE_EXTERNAL_MODEL_SQL } from "@/security/source-policy";

/** Searches only previously collected, approved public RSS evidence. No model-generated URLs. */
export class LocalPublicSearchProvider implements WebSearchProvider {
  readonly name = "local-index";
  constructor(private readonly database: DatabaseSync) {}
  async search(input: WebSearchInput): Promise<WebSearchResponse> {
    const query = input.query.trim();
    if (query.length < 2 || query.length > 500 || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 20) throw new Error("Invalid local source search parameters.");
    const startedAt = performance.now();
    const terms = [...new Set([...new Intl.Segmenter("zh", { granularity: "word" }).segment(query.toLowerCase())].filter((item) => item.isWordLike && item.segment.length >= 2).map((item) => item.segment))].slice(0, 24);
    let results: WebSearchResult[] = [];
    if (terms.length > 0) {
      const score = terms.map(() => "(CASE WHEN instr(lower(d.title),?)>0 THEN 3 ELSE 0 END + CASE WHEN instr(lower(d.raw_excerpt),?)>0 THEN 1 ELSE 0 END)").join("+");
      const rows = this.database.prepare(`SELECT d.id,d.canonical_url,d.title,d.published_at,substr(d.raw_excerpt,1,4000) AS excerpt,(${score}) AS score
        FROM documents d JOIN sources s ON s.id=d.source_id
        WHERE s.access_mode='rss' AND ${SOURCE_MAY_USE_EXTERNAL_MODEL_SQL}
        ${input.publicationWindow ? "AND datetime(d.published_at)>=datetime(?) AND datetime(d.published_at)<datetime(?)" : ""}
        AND (${terms.map(() => "instr(lower(d.title || ' ' || d.raw_excerpt),?)>0").join(" OR ")})
        ORDER BY score DESC,d.published_at DESC,d.id LIMIT 100`).all(...terms.flatMap((term) => [term, term]), ...(input.publicationWindow ? [input.publicationWindow.start, input.publicationWindow.end] : []), ...terms);
      const seen = new Set<string>();
      results = rows.filter((row) => {
        const url = String(row.canonical_url);
        if (seen.has(url) || !publicUrl(url)) return false;
        seen.add(url); return true;
      }).slice(0,input.limit).map((row) => ({ externalId: String(row.id), title: String(row.title), url: String(row.canonical_url), publishedAt: String(row.published_at) || null, highlights: [String(row.excerpt)] }));
    }
    return { providerRequestId: null, results, lineage: { provider: this.name, providerRequestId: null, latencyMs: Math.max(0, Math.round(performance.now() - startedAt)) } };
  }
}
function publicUrl(raw: string): boolean {
  try {
    const url = new URL(raw); const host = url.hostname.toLowerCase();
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !isIP(host) && host.includes(".") && !["localhost", "example.com", "example.org", "example.net"].some((name) => host === name || host.endsWith(`.${name}`)) && ![".invalid", ".local", ".localhost", ".test"].some((suffix) => host.endsWith(suffix));
  } catch { return false; }
}

/** A failed network lookup never becomes invented evidence; lineage records the actual local source. */
export class PublicSearchFallback implements WebSearchProvider {
  readonly name: string;
  constructor(private readonly primary: WebSearchProvider, private readonly fallback: WebSearchProvider) { this.name = primary.name; }
  async search(input: WebSearchInput): Promise<WebSearchResponse> {
    try { return await this.primary.search(input); }
    catch { return this.fallback.search(input); }
  }
}
