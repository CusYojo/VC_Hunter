import { readFileSync } from "node:fs";
import { join } from "node:path";

export type TestAccount = { username: string; name: string; password: string; teamUserId: string };
export type AuthFixture = { admin: TestAccount; member: TestAccount };
export function readAuthFixture(): AuthFixture {
  const directory = process.env.VC_HUNTER_AUTH_E2E_DIRECTORY;
  if (!directory || !readFileSync(join(directory, "auth-e2e-marker"), "utf8").startsWith("isolated-auth-e2e")) {
    throw new Error("Use scripts/auth-e2e.ts to run isolated authentication E2E tests");
  }
  return JSON.parse(readFileSync(join(directory, "accounts.json"), "utf8"));
}
