import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { username } from "better-auth/plugins";
import { createLocalAccountIssuer } from "@better-auth/core/db";
import { z } from "zod";
import { ORGANIZATION_ROLE_VALUES, type OrganizationRole } from "@/security/roles";
import { isValidUsername, usernameSchema } from "./username";
import { rotateCredentials as rotate, type CredentialRotation, type RotationOptions } from "./rotate-credentials";
import { migrateOrganization } from "@/organization/migrations";
import { createOrganizationService } from "@/organization/service";

export type AuthServiceOptions = { database: DatabaseSync; baseURL: string; secret: string; rateLimit?: boolean };
const invitationSchema = z.object({
  username: usernameSchema,
  name: z.string().trim().min(1).max(100), password: z.string().min(14).max(128),
  teamUserId: z.string().min(1).max(100), tenantId: z.string().min(1).max(100),
  roles: z.array(z.enum(ORGANIZATION_ROLE_VALUES)).min(1),
});
export type Invitation = z.infer<typeof invitationSchema>;
export type WorkspaceMembership = {
  id: string; userId: string; teamUserId: string; tenantId: string; roles: OrganizationRole[]; active: boolean;
};
const WORKSPACE_AUTH_SCHEMA = `CREATE TABLE IF NOT EXISTS workspace_memberships (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES user(id) ON DELETE CASCADE,
 team_user_id TEXT NOT NULL UNIQUE, tenant_id TEXT NOT NULL,
 roles TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);`;

/** User-selected password-only release: this does not assert email verification or MFA assurance. */
export function createAuthService(options: AuthServiceOptions) {
  const { database } = options;
  if (options.secret.length < 32) throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  const baseURL = new URL(options.baseURL);
  if (baseURL.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(baseURL.hostname)) throw new Error("Authentication requires HTTPS outside localhost");
  const auth = betterAuth({
    appName: "VC Hunter", database, baseURL: baseURL.origin, secret: options.secret,
    trustedOrigins: [baseURL.origin],
    emailAndPassword: { enabled: true, disableSignUp: true, requireEmailVerification: false, minPasswordLength: 14, maxPasswordLength: 128 },
    session: { expiresIn: 60 * 60 * 12, updateAge: 60 * 60, cookieCache: { enabled: false } },
    advanced: {
      disableOriginCheck: false, disableCSRFCheck: false, useSecureCookies: baseURL.protocol === "https:",
      defaultCookieAttributes: { httpOnly: true, sameSite: "strict" }, ipAddress: { ipAddressHeaders: ["x-real-ip"] },
    },
    rateLimit: { enabled: options.rateLimit !== false, storage: "database", window: 60, max: 30,
      customRules: { "/sign-in/username": { window: 60, max: 5 } } },
    // No mailbox is collected or exposed as a login/reset channel in this release.
    disabledPaths: ["/sign-in/email", "/send-verification-email", "/verify-email", "/change-email", "/request-password-reset", "/reset-password", "/is-username-available"],
    plugins: [username({ minUsernameLength: 2, maxUsernameLength: 30, usernameValidator: isValidUsername, immutableUsername: true, displayUsername: false })],
  });
  function membershipFor(userId: string): WorkspaceMembership | null {
    const row = database.prepare("SELECT * FROM workspace_memberships WHERE user_id = ? AND active = 1").get(userId);
    if (!row) return null;
    let roles: OrganizationRole[];
    try { roles = z.array(z.enum(ORGANIZATION_ROLE_VALUES)).min(1).parse(JSON.parse(String(row.roles))); } catch { return null; }
    return { id: String(row.id), userId, teamUserId: String(row.team_user_id), tenantId: String(row.tenant_id), roles, active: true };
  }
  async function requireSession(headers: Headers) {
    const result = await auth.api.getSession({ headers });
    if (!result || !result.user.username) return null;
    const membership = membershipFor(result.user.id);
    return membership ? { ...result, membership } : null;
  }
  async function migrate() {
    const migration = await getMigrations(auth.options); await migration.runMigrations();
    database.exec(WORKSPACE_AUTH_SCHEMA);
    migrateOrganization(database);
  }
  async function invite(input: Invitation) {
    const data = invitationSchema.parse(input);
    const context = await auth.$context;
    // The library requires this unique field; .invalid cannot receive mail and is never verified.
    const internalIdentifier = `${data.username}@accounts.invalid`;
    if (await context.internalAdapter.findUserByEmail(internalIdentifier)) throw new Error("An account already exists for that username");
    if (database.prepare("SELECT id FROM workspace_memberships WHERE team_user_id = ?").get(data.teamUserId)) throw new Error("This team member already has an account");
    const passwordHash = await context.password.hash(data.password);
    const user = await context.internalAdapter.createUser({ name: data.name, username: data.username, email: internalIdentifier, emailVerified: false }, { method: "admin" });
    try {
      await context.internalAdapter.linkAccount({ providerId: "credential", issuer: createLocalAccountIssuer("credential"), accountId: user.id, password: passwordHash, userId: user.id });
      database.prepare("INSERT INTO workspace_memberships(id, user_id, team_user_id, tenant_id, roles) VALUES (?, ?, ?, ?, ?)")
        .run(randomUUID(), user.id, data.teamUserId, data.tenantId, JSON.stringify(data.roles));
    } catch (error) {
      database.prepare("DELETE FROM workspace_memberships WHERE user_id = ?").run(user.id);
      await context.internalAdapter.deleteUser(user.id); throw error;
    }
    return { id: user.id, username: data.username, teamUserId: data.teamUserId };
  }
  async function rotateCredentials(input: CredentialRotation, options?: RotationOptions) {
    return rotate(database, (await auth.$context).password, input, options);
  }
  const organization = createOrganizationService(database, async () => (await auth.$context).password);
  return { auth, migrate, invite, requireSession, membershipFor, rotateCredentials, organization };
}
export type AuthService = ReturnType<typeof createAuthService>;
export type AuthenticatedSession = NonNullable<Awaited<ReturnType<AuthService["requireSession"]>>>;
