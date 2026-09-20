import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { FileRawArtifactStore } from "../src/connectors/raw-artifact-store";
import { HttpFeedTransport } from "../src/connectors/syndication-feed";
import { getDatabase } from "../src/db/client";
import { SqliteFeedIngestionRepository } from "../src/repositories/feed-ingestion";
import { ingestApprovedFeed } from "../src/services/feed-ingestion";

const sourceFlag = process.argv.indexOf("--source");
const sourceId = sourceFlag >= 0 ? process.argv[sourceFlag + 1] : undefined;
if (!sourceId) throw new Error("Usage: npm run collect:rss -- --source <source-id>");

const repository = new SqliteFeedIngestionRepository(
  getDatabase(),
  new FileRawArtifactStore(process.env.VC_HUNTER_RAW_DIR ?? join(process.cwd(), ".data", "raw-feeds")),
);
const result = await ingestApprovedFeed(repository, new HttpFeedTransport(), {
  sourceId,
  traceId: randomUUID(),
  observedAt: new Date().toISOString(),
});
process.stdout.write(`${JSON.stringify(result)}\n`);
