export const chatMigration = {
  id: "0024_ai_chat",
  upSql: `CREATE TABLE ai_chat_conversations (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '新对话', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_ai_chat_conversations_owner ON ai_chat_conversations(tenant_id,account_id,updated_at DESC);
  CREATE TABLE ai_chat_turns (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES ai_chat_conversations(id),
    tenant_id TEXT NOT NULL, account_id TEXT NOT NULL, request_key TEXT NOT NULL, payload_hash TEXT NOT NULL,
    prompt TEXT NOT NULL, context TEXT NOT NULL DEFAULT '', attachment_name TEXT, skill TEXT NOT NULL,
    project_id TEXT REFERENCES projects(id), use_knowledge INTEGER NOT NULL CHECK(use_knowledge IN (0,1)),
    status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed')),
    output TEXT NOT NULL DEFAULT '', error TEXT, provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
    sources_json TEXT NOT NULL DEFAULT '[]', warnings_json TEXT NOT NULL DEFAULT '[]', usage_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(tenant_id,account_id,conversation_id,request_key)
  );
  CREATE UNIQUE INDEX idx_ai_chat_active_account ON ai_chat_turns(tenant_id,account_id) WHERE status='running';
  CREATE INDEX idx_ai_chat_history ON ai_chat_turns(tenant_id,account_id,conversation_id,created_at);`,
  downSql: "DROP TABLE IF EXISTS ai_chat_turns; DROP TABLE IF EXISTS ai_chat_conversations;",
};
