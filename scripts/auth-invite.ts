import { randomBytes } from "node:crypto";
import { closeSync, openSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { parseArgs } from "node:util";
import { getAuthService } from "../src/auth/server";
import { isOrganizationRole } from "../src/security/roles";

async function main() {
  const { values } = parseArgs({ options: {
    username: { type: "string" }, name: { type: "string" }, "team-user": { type: "string" },
    tenant: { type: "string" }, roles: { type: "string" }, output: { type: "string" },
  } });
  if (!values.username || !values.name || !values["team-user"] || !values.output || !isAbsolute(values.output)) {
    throw new Error("Provide --username --name --team-user --output (absolute private file path)");
  }
  const roles = (values.roles || "investment_manager").split(",");
  if (!roles.every(isOrganizationRole)) throw new Error("Unknown role");
  const password = randomBytes(24).toString("base64url");
  // Claim output exclusively before provisioning, so an existing credential file is never overwritten.
  const descriptor = openSync(values.output, "wx", 0o600);
  try {
    const user = await getAuthService().invite({ username: values.username, name: values.name,
      teamUserId: values["team-user"], tenantId: values.tenant || process.env.VC_HUNTER_CURRENT_TENANT_ID || "vc-hunter",
      roles, password });
    writeFileSync(descriptor, JSON.stringify({ ...user, password,
      loginURL: new URL("/login", process.env.BETTER_AUTH_URL).href,
      instructions: "安全交付随机初始密码；使用账号和密码登录，不要求邮箱。本版不提供多因素认证保证。",
    }, null, 2));
  } finally { closeSync(descriptor); }
  console.log("Invited account provisioned. Username and password are in the private output file; no mailbox is required.");
}
main().catch(() => { console.error("Invitation failed. Check inputs, existing account and database; no secrets were printed."); process.exitCode = 1; });
