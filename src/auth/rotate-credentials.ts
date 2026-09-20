import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { usernameSchema } from "./username";

export const rotationSchema = z.object({
  targetUserId: z.string().min(1).max(128), currentUsername: usernameSchema, newUsername: usernameSchema,
  password: z.string().min(8).max(128).refine((value) => !/[\r\n\0]/.test(value), "Invalid password"),
}).strict();
export type CredentialRotation = z.input<typeof rotationSchema>;
export type RotationOptions = { allowShortPassword?: boolean };
type PasswordHasher = { hash: (password: string) => Promise<string>; verify: (input: { password: string; hash: string }) => Promise<boolean> };

function snapshot(database: DatabaseSync, id: string) {
  const user = database.prepare('SELECT username FROM "user" WHERE id = ?').get(id);
  const membership = database.prepare("SELECT team_user_id FROM workspace_memberships WHERE user_id = ?").get(id);
  const accounts = database.prepare('SELECT id, password FROM "account" WHERE userId = ? AND providerId = ?').all(id, "credential");
  if (!user || !membership || accounts.length !== 1 || typeof accounts[0].password !== "string" || !accounts[0].password) throw new Error("Rotation target or credential is unavailable");
  return { username: String(user.username), teamUserId: String(membership.team_user_id), accountId: String(accounts[0].id), hash: accounts[0].password };
}

/** Offline administrator maintenance only; never expose this operation as a public API. */
export async function rotateCredentials(database: DatabaseSync, hasher: PasswordHasher, input: CredentialRotation, options: RotationOptions = {}) {
  const data = rotationSchema.parse(input);
  if (data.password.length < (options.allowShortPassword === true ? 8 : 14)) throw new Error("Password does not meet the selected policy");
  const before = snapshot(database, data.targetUserId);
  const samePassword = await hasher.verify({ password: data.password, hash: before.hash });
  const alreadyApplied = before.username === data.newUsername && samePassword;
  if (!alreadyApplied && before.username !== data.currentUsername) throw new Error("Rotation target does not match the expected account");
  const hash = alreadyApplied ? before.hash : await hasher.hash(data.password);
  // Hashing is asynchronous. Lock and recheck the full snapshot before any writes.
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = snapshot(database, data.targetUserId);
    if (JSON.stringify(current) !== JSON.stringify(before)) throw new Error("Rotation target changed concurrently");
    const collision = database.prepare('SELECT id FROM "user" WHERE lower(username) = ? AND id != ?').get(data.newUsername, data.targetUserId);
    if (collision) throw new Error("Username is already assigned");
    if (!alreadyApplied) {
      const now = Date.now();
      database.prepare('UPDATE "user" SET username = ?, updatedAt = ? WHERE id = ?').run(data.newUsername, now, data.targetUserId);
      database.prepare('UPDATE "account" SET password = ?, updatedAt = ? WHERE id = ? AND userId = ? AND providerId = ?').run(hash, now, current.accountId, data.targetUserId, "credential");
      database.prepare('DELETE FROM "session" WHERE userId = ?').run(data.targetUserId);
    }
    database.exec("COMMIT");
    return { changed: !alreadyApplied, id: data.targetUserId, username: data.newUsername, teamUserId: current.teamUserId };
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}
