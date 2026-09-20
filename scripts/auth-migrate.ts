import { getAuthService } from "../src/auth/server";

async function main() {
  await getAuthService().migrate();
  console.log("Authentication schema is up to date. No user accounts were created.");
}
main().catch(() => { console.error("Authentication migration failed. Check configuration and database permissions."); process.exitCode = 1; });
