// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuthService } from "@/auth/service";

const origin = "http://localhost:3199";
const username = "vcadmin";
const password = "private-test-password-42!";
let database: DatabaseSync;
let service: ReturnType<typeof createAuthService>;
let cookies: Map<string, string>;
async function request(path: string, body?: object) {
  const response = await service.auth.handler(new Request(`${origin}/api/auth${path}`, {
    method: body ? "POST" : "GET", headers: { origin, "content-type": "application/json", cookie: cookieHeader(), "x-real-ip": "127.0.0.1" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";")[0]; const index = pair.indexOf("=");
    cookies.set(pair.slice(0, index), pair.slice(index + 1));
  }
  return response;
}
const cookieHeader = () => [...cookies].map(([key, value]) => `${key}=${value}`).join("; ");
const session = () => service.requireSession(new Headers({ cookie: cookieHeader() }));
const invite = () => service.invite({ username, name: "测试投资经理", password, teamUserId: "user-demo", tenantId: "firm", roles: ["investment_manager"] });
beforeEach(async () => {
  database = new DatabaseSync(":memory:"); cookies = new Map();
  service = createAuthService({ database, baseURL: origin, secret: randomBytes(32).toString("hex"), rateLimit: false });
  await service.migrate();
});
afterEach(() => database.close());

describe("private username/password workspace authentication", () => {
  it("blocks anonymous access and public registration", async () => {
    expect(await session()).toBeNull();
    expect((await request("/sign-up/email", { email: "intruder@example.test", password, name: "Intruder", username: "intruder" })).status).toBe(400);
    expect(database.prepare('SELECT count(*) AS count FROM "user"').get()?.count).toBe(0);
  });
  it("logs in by username without pretending an email or second factor was verified", async () => {
    await invite();
    expect((await request("/sign-in/username", { username, password })).status).toBe(200);
    const result = await session();
    expect(result?.membership.teamUserId).toBe("user-demo");
    expect(result?.user.username).toBe(username);
    expect(result?.user.emailVerified).toBe(false);
    expect(result?.user.email).toBe("vcadmin@accounts.invalid");
    expect((await request("/sign-in/email", { email: "vcadmin@accounts.invalid", password })).status).toBe(404);
    expect((await request("/two-factor/enable", { password })).status).toBe(404);
  });
  it("rejects wrong passwords and revokes the exact session on logout", async () => {
    await invite();
    expect((await request("/sign-in/username", { username, password: "wrong" })).status).toBe(401);
    await request("/sign-in/username", { username, password });
    const prior = new Headers({ cookie: cookieHeader() });
    expect((await request("/sign-out", {})).status).toBe(200);
    expect(await service.requireSession(prior)).toBeNull();
  });
  it("rejects inactive memberships, invalid roles, and untrusted origins", async () => {
    const invited = await invite(); await request("/sign-in/username", { username, password });
    database.prepare("UPDATE workspace_memberships SET active = 0 WHERE user_id = ?").run(invited.id);
    expect(await session()).toBeNull();
    database.prepare("UPDATE workspace_memberships SET active = 1, roles = ? WHERE user_id = ?").run('["superuser"]', invited.id);
    expect(await session()).toBeNull();
    const response = await service.auth.handler(new Request(`${origin}/api/auth/sign-out`, { method: "POST", headers: { origin: "https://attacker.invalid", cookie: cookieHeader(), "content-type": "application/json" }, body: "{}" }));
    expect(response.status).toBe(403);
  });
  it("validates invitations and prevents username or team-member collisions", async () => {
    await invite();
    await expect(invite()).rejects.toThrow("already exists");
    await expect(service.invite({ username: "another", name: "Other", password, teamUserId: "user-demo", tenantId: "firm", roles: ["viewer"] })).rejects.toThrow("already has");
    await expect(service.invite({ username: "@bad", name: "", password: "short", teamUserId: "", tenantId: "", roles: [] })).rejects.toThrow();
  });
  it("rejects short secrets and plaintext non-local origins", () => {
    expect(() => createAuthService({ database, baseURL: origin, secret: "short" })).toThrow("at least 32");
    expect(() => createAuthService({ database, baseURL: "http://example.test", secret: randomBytes(32).toString("hex") })).toThrow("HTTPS");
  });
  it("rate limits repeated username/password attempts using durable storage", async () => {
    service = createAuthService({ database, baseURL: origin, secret: randomBytes(32).toString("hex"), rateLimit: true });
    await service.migrate();
    for (let attempt = 0; attempt < 5; attempt += 1) await request("/sign-in/username", { username, password });
    expect((await request("/sign-in/username", { username, password })).status).toBe(429);
  });
});
