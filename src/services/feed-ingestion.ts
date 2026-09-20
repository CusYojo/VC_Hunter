import type { FeedTransport } from "@/connectors/syndication-feed";
import type { IngestionReceipt, SqliteFeedIngestionRepository } from "@/repositories/feed-ingestion";

export interface FeedIngestionRequest {
  sourceId: string;
  traceId: string;
  observedAt: string;
}

export async function ingestApprovedFeed(
  repository: SqliteFeedIngestionRepository,
  transport: FeedTransport,
  request: FeedIngestionRequest,
): Promise<IngestionReceipt> {
  const configuration = repository.findConfiguration(request.sourceId);
  if (!configuration) throw new Error("Configured feed source not found.");
  const runId = repository.beginRun(request.sourceId, request.traceId, request.observedAt);
  if (configuration.policyStatus !== "approved" || configuration.accessMode !== "rss" || !configuration.enabled) {
    repository.blockRun(runId, request.observedAt, "SOURCE_NOT_APPROVED", "Source must be approved and enabled.");
    throw new Error("Source must be approved and enabled before collection.");
  }
  try {
    const fetched = await transport.fetch(configuration);
    if (fetched.kind === "not_modified") return repository.completeNotModified(runId, request.sourceId, fetched, request.observedAt);
    return await repository.persistFetchedFeed(runId, configuration, fetched, request.observedAt);
  } catch {
    repository.failRun(runId, request.observedAt, "FETCH_FAILED");
    throw new Error("Feed collection failed.");
  }
}
