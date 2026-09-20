import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { DiscoveryLeadInput } from "@/connectors/deepseek-model-gateway";
import type { WebSearchLineage, WebSearchResponse } from "@/connectors/web-search";

export interface WebSearchReceipt { runId: string; resultCount: number; insertedCount: number; skippedCount: number; lineage?: WebSearchLineage; }

export class SqliteWebSearchRepository {
  constructor(private readonly database: DatabaseSync) {}
  begin(provider: string, query: string, traceId: string, observedAt: string): string {
    const id = randomUUID();
    this.database.prepare("INSERT INTO web_search_runs (id,provider,query,status,started_at,trace_id) VALUES (?,?,?,?,?,?)").run(id, provider, query, "running", observedAt, traceId);
    return id;
  }
  complete(runId: string, response: WebSearchResponse, observedAt: string): WebSearchReceipt {
    let insertedCount = 0;
    let skippedCount = 0;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      response.results.forEach((result, rank) => {
        const existing = this.database.prepare("SELECT id FROM web_search_leads WHERE url=?").get(result.url) as { id: string } | undefined;
        const leadId = existing?.id ?? `web-lead-${hash(result.url)}`;
        if (existing) skippedCount += 1; else insertedCount += 1;
        this.database.prepare(`INSERT INTO web_search_leads (id,url,title,published_at,highlights_json,first_seen_at,last_seen_at,status,publication_verified_at)
          VALUES (?,?,?,?,?,?,?,'discovered',?) ON CONFLICT(url) DO UPDATE SET title=excluded.title,published_at=excluded.published_at,highlights_json=excluded.highlights_json,last_seen_at=excluded.last_seen_at,publication_verified_at=excluded.publication_verified_at`).run(leadId, result.url, result.title, result.publishedAt, JSON.stringify(result.highlights), observedAt, observedAt, result.publicationVerifiedAt ?? null);
        this.database.prepare("INSERT INTO web_search_run_leads (run_id,lead_id,rank) VALUES (?,?,?)").run(runId, leadId, rank + 1);
      });
      this.database.prepare(`UPDATE web_search_runs SET provider=coalesce(?,provider),status='succeeded',finished_at=?,provider_request_id=?,result_count=?,inserted_count=?,skipped_count=? WHERE id=?`).run(response.lineage?.provider ?? null, observedAt, response.providerRequestId, response.results.length, insertedCount, skippedCount, runId);
      this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
    return { runId, resultCount: response.results.length, insertedCount, skippedCount, ...(response.lineage ? { lineage: response.lineage } : {}) };
  }
  fail(runId: string, observedAt: string): void {
    this.database.prepare("UPDATE web_search_runs SET status='failed',finished_at=?,error_code='SEARCH_FAILED' WHERE id=?").run(observedAt, runId);
  }

  listRunLeads(runId: string): DiscoveryLeadInput[] {
    const rows = this.database.prepare(`SELECT wsl.id,wsl.title,wsl.url,wsl.highlights_json
      FROM web_search_run_leads wsrl JOIN web_search_leads wsl ON wsl.id=wsrl.lead_id
      WHERE wsrl.run_id=? ORDER BY wsrl.rank`).all(runId) as unknown as Array<{ id: string; title: string; url: string; highlights_json: string }>;
    return rows.map((row) => ({ id: row.id, title: row.title, url: row.url, highlights: JSON.parse(row.highlights_json) as string[] }));
  }
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
