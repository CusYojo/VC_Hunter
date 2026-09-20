// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";

it("bootstraps vcadmin with a private random password and never overwrites an existing account", () => {
  const directory = mkdtempSync(join(tmpdir(), "vc-hunter-auth-cli-test-"));
  try {
    const databasePath = join(directory, "auth.db");
    const output = join(directory, "credential.json");
    const env = { ...process.env, NODE_ENV: "production" as const, BETTER_AUTH_URL: "http://127.0.0.1:3107",
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), VC_HUNTER_AUTH_DB_PATH: databasePath, VC_HUNTER_CURRENT_TENANT_ID: "cli-test" };
    const migrateOutput = execFileSync(process.execPath, ["--import", "tsx", "scripts/auth-migrate.ts"], { env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    expect(migrateOutput).toContain("schema is up to date");
    const args = ["--import", "tsx", "scripts/auth-invite.ts", "--username", "vcadmin", "--name", "示例经理", "--team-user", "user-demo", "--roles", "org_admin,investment_manager", "--output", output];
    const inviteOutput = execFileSync(process.execPath, args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const credential = JSON.parse(readFileSync(output, "utf8"));
    expect(credential.username).toBe("vcadmin");
    expect(credential.password.length >= 24).toBe(true);
    expect(inviteOutput.includes(credential.password)).toBe(false);
    expect(statSync(output).mode & 0o777).toBe(0o600);
    expect(statSync(databasePath).mode & 0o777).toBe(0o600);
    const database = new DatabaseSync(databasePath, { readOnly: true });
    expect(database.prepare('SELECT username, emailVerified FROM "user"').get()).toMatchObject({ username: "vcadmin", emailVerified: 0 });
    const stored = database.prepare('SELECT password FROM "account"').get();
    expect(stored?.password === credential.password).toBe(false);
    database.close();
    const repeated = spawnSync(process.execPath, args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(repeated.status).toBe(1);
    expect(JSON.parse(readFileSync(output, "utf8")).password === credential.password).toBe(true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 20_000);
