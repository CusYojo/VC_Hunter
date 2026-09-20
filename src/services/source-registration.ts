import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { validateConfiguredFeedUrl } from "@/connectors/feed-network-policy";
import { SqliteFeedIngestionRepository } from "@/repositories/feed-ingestion";

const feedSchema = z.object({
  endpointUrl: z.string().url(),
  allowedHostname: z.string().trim().min(1).max(253),
  enabled: z.boolean().default(false),
  timeoutMs: z.number().int().min(1_000).max(30_000).default(10_000),
  maxResponseBytes: z.number().int().min(1_024).max(5_242_880).default(2_097_152),
  maxItems: z.number().int().min(1).max(500).default(200),
}).strict();

const sourceSchema = z.object({
  id: z.string().trim().min(3).max(120).regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().trim().min(2).max(200),
  type: z.string().trim().min(2).max(80),
  authority: z.enum(["A", "B", "C", "D"]),
  robotsStatus: z.string().trim().min(2).max(80),
  licenseNotes: z.string().trim().min(4).max(2_000),
  policyStatus: z.enum(["approved", "manual_only", "blocked"]),
  independentGroup: z.string().trim().min(2).max(160),
  channel: z.enum(["venture_tech", "registry", "hiring", "ranking_award", "manual_codex", "legacy"]).default("legacy"),
  connectorType: z.enum(["public_search", "rss", "official_site", "licensed_api", "codex_bundle", "manual", "legacy"]).default("legacy"),
  accessClass: z.enum(["public", "licensed_internal", "user_supplied"]).default("user_supplied"),
  allowedStorage: z.enum(["metadata_only", "metadata_excerpt", "full_text_internal"]).default("metadata_only"),
  allowExternalModel: z.boolean().default(false),
  frequencyLimit: z.string().trim().max(200).nullable().default(null),
  termsReviewStatus: z.enum(["pending", "reviewed", "rejected"]).default("pending"),
  credentialRef: z.string().trim().regex(/^(?:env|secret):[A-Z0-9_./-]+$/u).nullable().default(null),
  feed: feedSchema.optional(),
}).strict().superRefine((source, context) => {
  if (source.accessClass !== "public" && source.allowExternalModel) context.addIssue({ code: "custom", message: "非公开来源不能允许外部模型使用。", path: ["allowExternalModel"] });
});

const manifestSchema = z.object({
  $comment: z.string().trim().max(2_000).optional(),
  sources: z.array(sourceSchema).max(500),
}).strict();
export type SourceManifest = z.input<typeof manifestSchema>;

export function syncSourceManifest(database: DatabaseSync, input: SourceManifest): { synced: number } {
  const manifest = manifestSchema.parse(input);
  const repository = new SqliteFeedIngestionRepository(database);
  const now = new Date().toISOString();
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const source of manifest.sources) {
      database.prepare(`INSERT INTO sources
        (id,name,source_type,authority,access_mode,robots_status,license_notes,policy_status,independent_group,last_checked_at,channel,connector_type,access_class,allowed_storage,allow_external_model,frequency_limit,terms_review_status,credential_ref)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,source_type=excluded.source_type,authority=excluded.authority,
          access_mode=excluded.access_mode,robots_status=excluded.robots_status,license_notes=excluded.license_notes,
          policy_status=excluded.policy_status,independent_group=excluded.independent_group,channel=excluded.channel,
          connector_type=excluded.connector_type,access_class=excluded.access_class,allowed_storage=excluded.allowed_storage,
          allow_external_model=excluded.allow_external_model,frequency_limit=excluded.frequency_limit,
          terms_review_status=excluded.terms_review_status,credential_ref=excluded.credential_ref`).run(
        source.id, source.name, source.type, source.authority, source.feed ? "rss" : "manual", source.robotsStatus, source.licenseNotes, source.policyStatus, source.independentGroup, now,
        source.channel, source.connectorType, source.accessClass, source.allowedStorage, Number(source.allowExternalModel), source.frequencyLimit, source.termsReviewStatus, source.credentialRef,
      );
      if (source.feed) {
        validateConfiguredFeedUrl(source.feed.endpointUrl, source.feed.allowedHostname);
        repository.upsertFeed({ sourceId: source.id, ...source.feed });
      }
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return { synced: manifest.sources.length };
}
