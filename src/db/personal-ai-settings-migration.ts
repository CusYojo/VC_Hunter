import type { DatabaseMigration } from "./migrations";

export const personalAISettingsMigration: DatabaseMigration = {
  id: "0018_personal_ai_settings",
  upSql: `
    CREATE TABLE personal_ai_provider_settings (
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      provider TEXT NOT NULL CHECK(provider IN ('openai','claude','kimi','deepseek','glm','qwen')),
      model TEXT NOT NULL,
      encrypted_key TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(tenant_id,account_id,provider)
    );
    CREATE TABLE personal_ai_preferences (
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      active_provider TEXT NOT NULL CHECK(active_provider IN ('openai','claude','kimi','deepseek','glm','qwen')),
      PRIMARY KEY(tenant_id,account_id)
    );
  `,
  downSql: `DROP TABLE IF EXISTS personal_ai_preferences; DROP TABLE IF EXISTS personal_ai_provider_settings;`,
};
