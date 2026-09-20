import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { WorkspaceIdentity } from "@/security/identity-scope";
import { AI_PROVIDER_IDS, aiProviderSettingsInputSchema, type AIProviderId, type AIProviderSettingsInput, type AISettingsView, type DecryptedAIConfiguration } from "./settings-contracts";

type AccountIdentity = Pick<WorkspaceIdentity, "tenantId" | "accountId">;
type ProviderRow = { provider: AIProviderId; model: string; encrypted_key: string; updated_at: string };
export class AISettingsError extends Error {
  constructor(readonly code: "API_KEY_REQUIRED" | "ENCRYPTION_UNAVAILABLE" | "INVALID_CONFIGURATION", message: string) { super(message); }
}
function requireIdentity(identity: AccountIdentity): void {
  if (!identity.tenantId.trim() || !identity.accountId.trim()) throw new AISettingsError("INVALID_CONFIGURATION", "账号身份无效。");
}
function encryptionKey(): Buffer {
  const dedicated = process.env.VC_HUNTER_AI_ENCRYPTION_KEY;
  if (dedicated) {
    const decoded = Buffer.from(dedicated, "base64");
    if (decoded.length !== 32 || decoded.toString("base64") !== dedicated) throw new AISettingsError("ENCRYPTION_UNAVAILABLE", "AI 密钥存储暂不可用，请联系管理员。");
    return decoded;
  }
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new AISettingsError("ENCRYPTION_UNAVAILABLE", "AI 密钥存储暂不可用，请联系管理员。");
  return Buffer.from(hkdfSync("sha256", secret, "vc-hunter-personal-ai-v1", "credentials-aes-256-gcm", 32));
}
function associatedData(identity: AccountIdentity, provider: AIProviderId): Buffer {
  return Buffer.from(JSON.stringify(["vc-hunter-personal-ai-v1", identity.tenantId, identity.accountId, provider]));
}
function encrypt(apiKey: string, identity: AccountIdentity, provider: AIProviderId): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(associatedData(identity, provider));
  const bytes = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), bytes.toString("base64")].join(":");
}
function decrypt(encrypted: string, identity: AccountIdentity, provider: AIProviderId): string {
  try {
    const [version, iv, tag, bytes, extra] = encrypted.split(":");
    if (version !== "v1" || !iv || !tag || !bytes || extra !== undefined) throw new Error("Invalid envelope");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
    decipher.setAAD(associatedData(identity, provider));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(bytes, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new AISettingsError("ENCRYPTION_UNAVAILABLE", "AI 密钥无法读取，请重新保存密钥或联系管理员。");
  }
}

export function getSavedAISettings(database: DatabaseSync, identity: AccountIdentity): AISettingsView {
  requireIdentity(identity);
  const rows = database.prepare("SELECT provider,model,updated_at FROM personal_ai_provider_settings WHERE tenant_id=? AND account_id=?")
    .all(identity.tenantId, identity.accountId) as Array<Pick<ProviderRow, "provider" | "model" | "updated_at">>;
  const preference = database.prepare("SELECT active_provider FROM personal_ai_preferences WHERE tenant_id=? AND account_id=?")
    .get(identity.tenantId, identity.accountId) as { active_provider: AIProviderId } | undefined;
  return {
    activeProvider: preference?.active_provider ?? null,
    providers: AI_PROVIDER_IDS.map((provider) => {
      const row = rows.find((candidate) => candidate.provider === provider);
      return { provider, model: row?.model ?? "", configured: Boolean(row), updatedAt: row?.updated_at ?? null };
    }),
  };
}
export function saveAIProviderSettings(database: DatabaseSync, identity: AccountIdentity, rawInput: AIProviderSettingsInput): AISettingsView {
  requireIdentity(identity);
  const parsed = aiProviderSettingsInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AISettingsError("INVALID_CONFIGURATION", "AI 配置参数无效。");
  const input = parsed.data;
  const existing = database.prepare("SELECT encrypted_key FROM personal_ai_provider_settings WHERE tenant_id=? AND account_id=? AND provider=?")
    .get(identity.tenantId, identity.accountId, input.provider) as { encrypted_key: string } | undefined;
  if (!input.apiKey && !existing) throw new AISettingsError("API_KEY_REQUIRED", "请填写此服务商的 API Key。");
  // Validate retained credentials before activating them; fail closed on a key rotation or damaged record.
  if (!input.apiKey && existing) decrypt(existing.encrypted_key, identity, input.provider);
  const encrypted = input.apiKey ? encrypt(input.apiKey, identity, input.provider) : existing!.encrypted_key;
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare(`INSERT INTO personal_ai_provider_settings (tenant_id,account_id,provider,model,encrypted_key,updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(tenant_id,account_id,provider) DO UPDATE SET model=excluded.model,encrypted_key=excluded.encrypted_key,updated_at=excluded.updated_at`)
      .run(identity.tenantId, identity.accountId, input.provider, input.model, encrypted, new Date().toISOString());
    if (input.activate !== false) database.prepare(`INSERT INTO personal_ai_preferences (tenant_id,account_id,active_provider) VALUES (?,?,?)
      ON CONFLICT(tenant_id,account_id) DO UPDATE SET active_provider=excluded.active_provider`).run(identity.tenantId, identity.accountId, input.provider);
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); throw error; }
  return getSavedAISettings(database, identity);
}
export function deleteAIProviderSettings(database: DatabaseSync, identity: AccountIdentity, provider: AIProviderId): AISettingsView {
  requireIdentity(identity);
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("DELETE FROM personal_ai_provider_settings WHERE tenant_id=? AND account_id=? AND provider=?").run(identity.tenantId, identity.accountId, provider);
    database.prepare("DELETE FROM personal_ai_preferences WHERE tenant_id=? AND account_id=? AND active_provider=?").run(identity.tenantId, identity.accountId, provider);
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); throw error; }
  return getSavedAISettings(database, identity);
}
export function getDecryptedSelectedConfiguration(database: DatabaseSync, identity: AccountIdentity): DecryptedAIConfiguration | null {
  requireIdentity(identity);
  const row = database.prepare(`SELECT p.provider,p.model,p.encrypted_key,p.updated_at FROM personal_ai_provider_settings p
    JOIN personal_ai_preferences s ON p.tenant_id=s.tenant_id AND p.account_id=s.account_id AND p.provider=s.active_provider
    WHERE p.tenant_id=? AND p.account_id=?`).get(identity.tenantId, identity.accountId) as ProviderRow | undefined;
  return row ? { provider: row.provider, model: row.model, apiKey: decrypt(row.encrypted_key, identity, row.provider) } : null;
}
