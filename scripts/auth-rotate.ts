import { closeSync, constants, fstatSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { parseArgs } from "node:util";
import { getAuthService } from "../src/auth/server";
import { rotationSchema } from "../src/auth/rotate-credentials";

function absolutePath(value: string | undefined) {
  if (!value || !isAbsolute(value) || resolve(value) !== value) throw new Error("An absolute canonical file path is required");
  return value;
}
function readPrivateInput(path: string) {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.size > 16_384 || stat.uid !== process.getuid?.()) throw new Error("Input must be an owned 0600 private regular file");
    return rotationSchema.parse(JSON.parse(readFileSync(descriptor, "utf8")));
  } finally { closeSync(descriptor); }
}
async function main() {
  const { values } = parseArgs({ options: { input: { type: "string" }, output: { type: "string" }, "allow-short-password": { type: "boolean", default: false } } });
  const input = readPrivateInput(absolutePath(values.input));
  if (input.password.length < (values["allow-short-password"] ? 8 : 14)) throw new Error("Password does not meet the selected policy");
  const loginURL = new URL("/login", process.env.BETTER_AUTH_URL).href;
  // Claim an optional delivery file before changing credentials; never overwrite any existing file.
  const output = values.output ? openSync(absolutePath(values.output), "wx", 0o600) : undefined;
  try {
    const { changed, ...user } = await getAuthService().rotateCredentials(input, { allowShortPassword: values["allow-short-password"] });
    if (output !== undefined) writeFileSync(output, JSON.stringify({ ...user, password: input.password, loginURL }, null, 2));
    console.log(changed ? "Account credentials rotated; previous sessions revoked. No secrets printed." : "Requested credentials already applied; current sessions preserved. No secrets printed.");
  } finally { if (output !== undefined) closeSync(output); }
}
main().catch(() => { console.error("Credential rotation failed. Check private input, target account and output path. No secrets printed."); process.exitCode = 1; });
