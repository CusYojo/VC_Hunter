/** Offline, explicit organization import. Passwords are read only from a private file. */
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { parseArgs } from "node:util";
import { rosterSchema } from "../src/organization/contracts";

function readJson(path: string, privateFile = false): unknown {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > (privateFile ? 16_384 : 4 * 1024 * 1024)) throw new Error("Invalid input file");
    if (privateFile && ((stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid?.())) throw new Error("Expected owned 0600 input");
    return JSON.parse(readFileSync(fd, "utf8"));
  } finally { closeSync(fd); }
}
function canonicalPath(path: string | undefined) {
  if (!path || !isAbsolute(path) || resolve(path) !== path) throw new Error("Explicit canonical path required");
  return path;
}
async function main() {
  const { values } = parseArgs({ options: {
    roster: { type: "string" }, apply: { type: "boolean", default: false }, db: { type: "string" },
    "password-file": { type: "string" }, "allow-short-password": { type: "boolean", default: false },
    "expected-members": { type: "string" },
  } });
  if (!values.roster) throw new Error("Roster required");
  const roster = rosterSchema.parse(readJson(resolve(values.roster)));
  if (values["expected-members"] !== undefined && (!/^\d+$/.test(values["expected-members"]) || Number(values["expected-members"]) !== roster.members.length)) throw new Error("Unexpected roster size");
  const summary = { departments: roster.departments.length, members: roster.members.length,
    namedPeople: roster.members.filter((row) => !row.isPlaceholder).length, placeholders: roster.members.filter((row) => row.isPlaceholder).length };
  if (!values.apply) { console.log(JSON.stringify({ mode: "dry-run", ...summary, databaseOpened: false })); return; }
  const dbPath = canonicalPath(values.db);
  const dbStat = lstatSync(dbPath);
  if (!dbStat.isFile() || dbStat.isSymbolicLink() || dbStat.uid !== process.getuid?.() || (dbStat.mode & 0o077) !== 0) throw new Error("Expected owned private auth database");
  if (process.env.VC_HUNTER_AUTH_DB_PATH !== dbPath || process.env.VC_HUNTER_CURRENT_TENANT_ID !== roster.tenantId) throw new Error("Database or tenant differs from private environment");
  const record = readJson(canonicalPath(values["password-file"]), true) as { password?: unknown };
  if (!record || typeof record.password !== "string" || record.password.length < (values["allow-short-password"] ? 8 : 14) || record.password.length > 128 || /[\r\n\0]/.test(record.password)) throw new Error("Invalid password input");
  const { getAuthService } = await import("../src/auth/server");
  const service = getAuthService();
  // Schema migrations are run by the release activation before data import.
  const result = await service.organization.bulkImport(roster, record.password, { allowShortPassword: values["allow-short-password"] });
  console.log(JSON.stringify({ mode: "applied", ...summary, ...result, existingCredentialsPreserved: true }));
}
main().catch(() => { console.error("Organization import refused. Check roster, private input, migration, database and tenant. No credentials printed."); process.exitCode = 1; });
