// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createAuthService } from "@/auth/service";

let db: DatabaseSync;
let service: ReturnType<typeof createAuthService>;
const origin = "http://localhost:3199";
const oldPassword = randomBytes(24).toString("base64url");
const password = randomBytes(4).toString("hex");
const account = { username: "testadmin", name: "测试管理员", password: oldPassword, teamUserId: "test-owner", tenantId: "test-firm", roles: ["org_admin"] as ["org_admin"] };
async function login(username: string, secret: string) {
  return service.auth.handler(new Request(`${origin}/api/auth/sign-in/username`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ username, password: secret }) }));
}
const headersFor = (response: Response) => new Headers({ cookie: response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ") });
beforeEach(async () => {
  db = new DatabaseSync(":memory:");
  service = createAuthService({ database: db, baseURL: origin, secret: randomBytes(32).toString("hex"), rateLimit: false });
  await service.migrate();
});
afterEach(() => db.close());

it("rotates the same account into Chinese, revokes all sessions and is repeat-safe", async () => {
  const user = await service.invite(account);
  const before = db.prepare('SELECT * FROM workspace_memberships WHERE user_id = ?').get(user.id);
  const stale = headersFor(await login(account.username, oldPassword));
  await login(account.username, oldPassword);
  const input = { targetUserId: user.id, currentUsername: account.username, newUsername: "示例经理", password };
  const result = await service.rotateCredentials(input, { allowShortPassword: true });
  expect(result).toMatchObject({ changed: true, id: user.id, username: "示例经理", teamUserId: account.teamUserId });
  expect(await service.requireSession(stale)).toBeNull();
  expect(db.prepare('SELECT count(*) AS n FROM session WHERE userId = ?').get(user.id)?.n).toBe(0);
  expect((await login(account.username, oldPassword)).status).toBe(401);
  expect((await login("示例经理", oldPassword)).status).toBe(401);
  const signedIn = await login("示例经理", password);
  expect(signedIn.status).toBe(200);
  const fresh = headersFor(signedIn);
  expect((await service.requireSession(fresh))?.user.id).toBe(user.id);
  expect((await service.rotateCredentials(input, { allowShortPassword: true })).changed).toBe(false);
  expect((await service.requireSession(fresh))?.user.id).toBe(user.id);
  expect(db.prepare('SELECT * FROM workspace_memberships WHERE user_id = ?').get(user.id)).toEqual(before);
  expect(db.prepare('SELECT email, emailVerified FROM user WHERE id = ?').get(user.id)).toMatchObject({ email: "testadmin@accounts.invalid", emailVerified: 0 });
  expect(db.prepare('SELECT password FROM account WHERE userId = ?').get(user.id)?.password === password).toBe(false);
});

it("requires explicit short-password exception and preserves default invitation policy", async () => {
  const user = await service.invite(account);
  const input = { targetUserId: user.id, currentUsername: account.username, newUsername: "中文账号", password };
  await expect(service.rotateCredentials(input)).rejects.toThrow();
  await expect(service.rotateCredentials({ ...input, password: "tiny" }, { allowShortPassword: true })).rejects.toThrow();
  await expect(service.invite({ ...account, username: "中文账号", password, teamUserId: "another" })).rejects.toThrow();
  await service.rotateCredentials({ ...input, password: randomBytes(24).toString("hex") });
});

it("rejects wrong targets, collisions and missing credential without mutations", async () => {
  const user = await service.invite(account);
  await service.invite({ ...account, username: "中文账号", teamUserId: "another" });
  const input = { targetUserId: user.id, currentUsername: account.username, newUsername: "新管理员", password: oldPassword };
  const before = db.prepare('SELECT * FROM user WHERE id = ?').get(user.id);
  await expect(service.rotateCredentials({ ...input, targetUserId: "missing" })).rejects.toThrow();
  await expect(service.rotateCredentials({ ...input, currentUsername: "incorrect" })).rejects.toThrow();
  await expect(service.rotateCredentials({ ...input, newUsername: "中文账号" })).rejects.toThrow();
  expect(db.prepare('SELECT * FROM user WHERE id = ?').get(user.id)).toEqual(before);
  db.prepare("DELETE FROM account WHERE userId = ?").run(user.id);
  await expect(service.rotateCredentials(input)).rejects.toThrow();
  expect(db.prepare('SELECT * FROM user WHERE id = ?').get(user.id)).toEqual(before);
});

it("uses the same Chinese/ASCII username rule for invitations and login", async () => {
  await service.invite({ ...account, username: "中文Admin_.1" });
  expect((await login("中文admin_.1", oldPassword)).status).toBe(200);
  for (const username of ["中a", "a-b", "abc@", "a b", "测试😀", "étest", "a".repeat(31)]) {
    await expect(service.invite({ ...account, username, teamUserId: "other" })).rejects.toThrow();
  }
});
