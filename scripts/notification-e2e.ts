import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { createDatabase, initializeDatabase } from "../src/db/client";
import { seedDemoData } from "../src/db/seed";
import { createAuthService } from "../src/auth/service";
import type { TestAccount } from "../tests/auth-e2e/fixtures";

const origin = "http://127.0.0.1:3108";
const tenant = "isolated-auth-e2e";
let setupStage = "port availability";

async function prepareAccount(service: ReturnType<typeof createAuthService>, username: string, name: string, teamUserId: string, admin: boolean): Promise<TestAccount> {
  const password = randomBytes(24).toString("base64url");
  await service.invite({ username, name, password, teamUserId, tenantId: tenant, roles: admin ? ["org_admin", "investment_manager"] : ["investment_manager"] });
  return { username, name, password, teamUserId };
}

async function prepare(directory: string): Promise<NodeJS.ProcessEnv> {
  const secret = randomBytes(32).toString("hex");
  const databasePath = join(directory, "business.db");
  const authPath = join(directory, "auth.db");
  const database = createDatabase(databasePath);
  initializeDatabase(database); seedDemoData(database);
  database.prepare("UPDATE projects SET owner = ? WHERE id = ?").run("E2E管理员", "project-qiongxin");
  database.close();
  const authDatabase = new DatabaseSync(authPath);
  chmodSync(authPath, 0o600);
  const service = createAuthService({ database: authDatabase, secret, baseURL: origin, rateLimit: false });
  await service.migrate();
  const admin = await prepareAccount(service, "e2eadmin", "E2E管理员", "user-demo", true);
  const member = await prepareAccount(service, "e2emember", "E2E成员", "user-linchuan", false);
  authDatabase.close();
  writeFileSync(join(directory, "accounts.json"), JSON.stringify({ admin, member }), { mode: 0o600 });
  const teamPath = join(directory, "team.json");
  writeFileSync(teamPath, JSON.stringify([admin, member].map((account) => ({ id: account.teamUserId, name: account.name, role: "投资经理", tracks: ["AI", "半导体"], subtracks: [], currentLoad: 0 }))), { mode: 0o600 });
  writeFileSync(join(directory, "auth-e2e-marker"), "isolated-auth-e2e\n", { mode: 0o600 });
  return { ...process.env, NODE_ENV: "production", PORT: "3108", VC_HUNTER_AUTH_ENABLED: "true", BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: secret, VC_HUNTER_AI_ENCRYPTION_KEY: randomBytes(32).toString("base64"), VC_HUNTER_DB_PATH: databasePath, VC_HUNTER_AUTH_DB_PATH: authPath,
    VC_HUNTER_DOCUMENT_ROOT: join(directory, "project-documents"), VC_HUNTER_TEAM_CONFIG: teamPath, VC_HUNTER_CURRENT_TENANT_ID: tenant, VC_HUNTER_AUTH_E2E_DIRECTORY: directory,
    PLAYWRIGHT_NO_COPY_PROMPT: "1" };
}

async function checkPort() {
  const probe = createServer();
  probe.listen(3108, "127.0.0.1");
  await once(probe, "listening");
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
}
async function waitUntilReady(server: ChildProcess) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error("Isolated Next server exited before readiness");
    try { if ((await fetch(`${origin}/login`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* startup only */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Isolated Next server readiness timeout");
}
async function stop(child?: ChildProcess) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 5000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
async function main() {
  await checkPort();
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "vc-hunter-auth-e2e-")));
  let server: ChildProcess | undefined;
  try {
    setupStage = "isolated account setup";
    const env = await prepare(directory);
    setupStage = "notification server readiness";
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3108"], { env, stdio: "ignore" });
    await waitUntilReady(server);
    setupStage = "notification browser tests";
    const tests = spawn(process.execPath, ["node_modules/playwright/cli.js", "test", "--config", "playwright.notifications.config.ts", ...process.argv.slice(2)], { env, stdio: ["ignore", "inherit", "ignore"] });
    const [code] = await once(tests, "exit");
    process.exitCode = Number(code ?? 1);
  } finally {
    await stop(server);
    // Only this invocation's freshly-created private test directory is removed.
    rmSync(directory, { recursive: true, force: true });
  }
}
main().catch((error: unknown) => { console.error(`[notification-e2e] ${setupStage} failed (${error instanceof Error ? error.name : "unknown error"}). No credentials printed.`); process.exitCode = 1; });
