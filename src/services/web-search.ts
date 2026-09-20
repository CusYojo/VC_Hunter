import { verifyNewsPublication } from "@/connectors/news-publication-verifier";
import { isPublishedInWindow, normalizeNewsPublishedAt, publicationWindowForDay } from "@/domain/news-publication";
import type { WebSearchProvider } from "@/connectors/web-search";
import type { SqliteWebSearchRepository, WebSearchReceipt } from "@/repositories/web-search";

export interface DiscoverySearchInput {
  query: string; limit: number; traceId: string; observedAt: string;
  channel?: "venture_tech" | "registry" | "hiring" | "ranking_award";
  queryFamily?: string; cities?: readonly string[]; subtracks?: readonly string[];
  dateWindowDays?: number; preferredDomains?: readonly string[];
}

export async function discoverWebLeads(repository: SqliteWebSearchRepository, provider: WebSearchProvider, input: DiscoverySearchInput, verifyPublication: (url: string) => Promise<string | null> = verifyNewsPublication): Promise<WebSearchReceipt> {
  const query = input.query.trim();
  const runId = repository.begin(provider.name, query, input.traceId, input.observedAt);
  try {
    const publicationWindow = input.dateWindowDays === undefined ? publicationWindowForDay(input.observedAt) : {
      start: new Date(Date.parse(input.observedAt) - input.dateWindowDays * 86_400_000).toISOString(),
      end: new Date(Date.parse(input.observedAt) + 1).toISOString(),
    };
    const preferredDomains = input.preferredDomains?.length ? input.preferredDomains : input.channel && input.channel !== "venture_tech" ? [] : ["chinaventure.com.cn", "36kr.com"];
    const hasSearchContext = Boolean(input.channel || input.queryFamily || input.cities?.length || input.subtracks?.length);
    const response = await provider.search({ query, limit: input.limit, publicationWindow, preferredDomains, ...(hasSearchContext ? { searchContext: { channel: input.channel ?? "venture_tech", queryFamily: input.queryFamily ?? "manual", cities: input.cities ?? [], subtracks: input.subtracks ?? [] } } : {}) });
    const newsChannel = !input.channel || input.channel === "venture_tech";
    const eligible = response.results.flatMap(result => {
      const publishedAt = normalizeNewsPublishedAt(result.publishedAt);
      if (newsChannel) return isPublishedInWindow(publishedAt, publicationWindow) && Date.parse(publishedAt!) <= Date.parse(input.observedAt) ? [{ ...result, publishedAt }] : [];
      if (publishedAt && (!isPublishedInWindow(publishedAt, publicationWindow) || Date.parse(publishedAt) > Date.parse(input.observedAt))) return [];
      return [{ ...result, publishedAt: publishedAt ?? input.observedAt }];
    });
    const verified = [];
    if (!newsChannel) verified.push(...eligible);
    for (let offset = 0; newsChannel && offset < eligible.length; offset += 3) {
      const batch = await Promise.all(eligible.slice(offset, offset + 3).map(async result => {
        const publishedAt = normalizeNewsPublishedAt(await verifyPublication(result.url));
        if (!isPublishedInWindow(publishedAt, publicationWindow) || Date.parse(publishedAt!) > Date.parse(input.observedAt)) return null;
        return { ...result, publishedAt, publicationVerifiedAt: input.observedAt };
      }));
      verified.push(...batch.filter(result => result !== null));
    }
    return repository.complete(runId, { ...response, results: verified }, input.observedAt);
  } catch {
    repository.fail(runId, input.observedAt);
    throw new Error("Web search failed.");
  }
}
