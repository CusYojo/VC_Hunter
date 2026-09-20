import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { deleteAIProviderSettings, getDecryptedSelectedConfiguration, getSavedAISettings, saveAIProviderSettings } from "@/ai/settings-repository";
import { handleAISettings } from "@/ai/settings-http";
import { identityScope, type WorkspaceIdentity } from "@/security/identity-scope";

const alice = { tenantId: "tenant-one", accountId: "account-alice" };
const bob = { tenantId: "tenant-one", accountId: "account-bob" };
const otherTenant = { tenantId: "tenant-two", accountId: "account-alice" };
const secret = "test-provider-secret-never-return";
const input = { provider: "openai" as const, model: "gpt-4.1", apiKey: secret };
const asIdentity = (identity = alice) => ({ ...identity, roles: ["viewer"], user: { id: "same-team-id", name: "成员", role: "viewer", capabilities: [] } }) as WorkspaceIdentity;

describe("personal AI settings", () => {
  let db: DatabaseSync;
  beforeEach(() => { db = createDatabase(":memory:"); initializeDatabase(db); vi.stubEnv("VC_HUNTER_AI_ENCRYPTION_KEY", Buffer.alloc(32, 17).toString("base64")); });
  afterEach(() => { db.close(); vi.unstubAllEnvs(); });
  it("encrypts at rest and never returns credentials or a suffix", () => {
    const view = saveAIProviderSettings(db, alice, input);
    expect(view.activeProvider).toBe("openai");
    expect(view.providers.find((item) => item.provider === "openai")).toMatchObject({ model: "gpt-4.1", configured: true });
    expect(JSON.stringify(view)).not.toContain(secret);
    expect(JSON.stringify(db.prepare("SELECT * FROM personal_ai_provider_settings").all())).not.toContain(secret);
    expect(getDecryptedSelectedConfiguration(db, alice)).toEqual(input);
  });
  it("isolates both account and tenant even with the same team identity", () => {
    saveAIProviderSettings(db, alice, input);
    expect(getDecryptedSelectedConfiguration(db, bob)).toBeNull();
    expect(getDecryptedSelectedConfiguration(db, otherTenant)).toBeNull();
    deleteAIProviderSettings(db, bob, "openai");
    expect(getDecryptedSelectedConfiguration(db, alice)?.apiKey).toBe(secret);
  });
  it("keeps a saved key for a blank-key model change but requires keys on new providers", () => {
    saveAIProviderSettings(db, alice, input);
    saveAIProviderSettings(db, alice, { provider: "openai", model: "gpt-4.1-mini", apiKey: "" });
    expect(getDecryptedSelectedConfiguration(db, alice)).toEqual({ ...input, model: "gpt-4.1-mini" });
    expect(() => saveAIProviderSettings(db, alice, { provider: "claude", model: "claude-sonnet-4-6" })).toThrow("请填写此服务商的 API Key。");
  });
  it("retains separate provider credentials and erases only the selected provider", () => {
    saveAIProviderSettings(db, alice, input);
    saveAIProviderSettings(db, alice, { provider: "qwen", model: "qwen-plus", apiKey: "qwen-private", activate: false });
    expect(getSavedAISettings(db, alice).activeProvider).toBe("openai");
    deleteAIProviderSettings(db, alice, "openai");
    expect(getDecryptedSelectedConfiguration(db, alice)).toBeNull();
    expect(getSavedAISettings(db, alice).providers.find((item) => item.provider === "qwen")?.configured).toBe(true);
  });
  it("binds ciphertext to tenant, account and provider and rejects tampering", () => {
    saveAIProviderSettings(db, alice, input);
    db.prepare("UPDATE personal_ai_provider_settings SET account_id=? WHERE account_id=?").run(bob.accountId, alice.accountId);
    db.prepare("UPDATE personal_ai_preferences SET account_id=? WHERE account_id=?").run(bob.accountId, alice.accountId);
    expect(() => getDecryptedSelectedConfiguration(db, bob)).toThrow();
  });
  it("rejects cross-provider ciphertext swaps and damaged encryption envelopes", () => {
    saveAIProviderSettings(db, alice, input);
    saveAIProviderSettings(db, alice, { provider: "claude", model: "claude-sonnet-4-6", apiKey: "separate-private-key" });
    const original = db.prepare("SELECT encrypted_key FROM personal_ai_provider_settings WHERE provider='openai'").get() as { encrypted_key: string };
    db.prepare("UPDATE personal_ai_provider_settings SET encrypted_key=? WHERE provider='claude'").run(original.encrypted_key);
    expect(() => getDecryptedSelectedConfiguration(db, alice)).toThrow();
    db.prepare("UPDATE personal_ai_provider_settings SET encrypted_key='v0:damaged' WHERE provider='claude'").run();
    expect(() => getDecryptedSelectedConfiguration(db, alice)).toThrow();
  });
  it("does not change saved settings when a replacement key fails encryption", () => {
    saveAIProviderSettings(db, alice, input);
    vi.stubEnv("VC_HUNTER_AI_ENCRYPTION_KEY", "invalid");
    expect(() => saveAIProviderSettings(db, alice, { ...input, model: "replacement" })).toThrow();
    expect(getSavedAISettings(db, alice).providers.find((item) => item.provider === "openai")?.model).toBe(input.model);
  });
  it("fails closed with invalid or missing encryption configuration", () => {
    vi.stubEnv("VC_HUNTER_AI_ENCRYPTION_KEY", "bad-key");
    expect(() => saveAIProviderSettings(db, alice, input)).toThrow();
    vi.stubEnv("VC_HUNTER_AI_ENCRYPTION_KEY", ""); vi.stubEnv("BETTER_AUTH_SECRET", "");
    expect(() => saveAIProviderSettings(db, alice, input)).toThrow();
    expect(getSavedAISettings(db, alice).activeProvider).toBeNull();
  });
  it("supports the authentication-secret fallback with domain-separated key derivation", () => {
    vi.stubEnv("VC_HUNTER_AI_ENCRYPTION_KEY", ""); vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(40));
    saveAIProviderSettings(db, alice, input);
    expect(getDecryptedSelectedConfiguration(db, alice)?.apiKey).toBe(secret);
  });
  it("rejects unauthenticated callers even when the development auth wrapper is disabled", async () => {
    const response = await handleAISettings(new Request("http://localhost/api/v1/settings/ai"), db);
    expect(response.status).toBe(401);
  });
  it("allows viewer own settings and returns no-store responses without secret data", async () => {
    const response = await identityScope.run(asIdentity(), () => handleAISettings(new Request("http://localhost/api/v1/settings/ai", { method: "PUT", body: JSON.stringify(input) }), db));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).not.toContain(secret);
  });
  it("returns stable errors for malformed JSON, invalid deletions and encryption failures", async () => {
    for (const [method, body] of [["PUT", "not-json"], ["DELETE", '{"provider":"unknown"}']]) {
      const response = await identityScope.run(asIdentity(), () => handleAISettings(new Request("http://localhost/api/v1/settings/ai", { method, body }), db));
      expect(response.status).toBe(400);
    }
    vi.stubEnv("VC_HUNTER_AI_ENCRYPTION_KEY", "broken-private-encryption-key");
    const response = await identityScope.run(asIdentity(), () => handleAISettings(new Request("http://localhost/api/v1/settings/ai", { method: "PUT", body: JSON.stringify(input) }), db));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("broken-private-encryption-key");
  });
  it("rejects target-account injection, arbitrary endpoints, unsupported providers and oversized bodies", async () => {
    for (const extra of [{ accountId: bob.accountId }, { baseUrl: "http://127.0.0.1" }, { provider: "unknown" }]) {
      const response = await identityScope.run(asIdentity(), () => handleAISettings(new Request("http://localhost/api/v1/settings/ai", { method: "PUT", body: JSON.stringify({ ...input, ...extra }) }), db));
      expect(response.status).toBe(400);
    }
    const response = await identityScope.run(asIdentity(), () => handleAISettings(new Request("http://localhost/api/v1/settings/ai", { method: "PUT", body: "x".repeat(20_000) }), db));
    expect(response.status).toBe(413);
    expect(getDecryptedSelectedConfiguration(db, alice)).toBeNull();
  });
});
