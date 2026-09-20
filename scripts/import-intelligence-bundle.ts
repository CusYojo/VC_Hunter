import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { IntelligenceDiscoveryRepository } from "../src/intelligence/repository";

const MAX_BYTES = 16 * 1024 * 1024;

const args = new Map(
  process.argv.slice(2).map((argument) => {
    const separator = argument.indexOf("=");
    return separator === -1 ? [argument, ""] : [argument.slice(0, separator), argument.slice(separator + 1)];
  }),
);

const inputPath = absoluteFile(args.get("--input"), "--input");
const databasePath = absoluteFile(args.get("--db"), "--db");
const actorId = required(args.get("--actor"), "--actor");
const idempotencyKey = required(args.get("--idempotency-key"), "--idempotency-key");
const tenantId = args.get("--tenant")?.trim() || "organization";
const shouldCommit = args.has("--commit");
const expected = Number(args.get("--expect") || "0");

if (![...args.keys()].every((key) => ["--input", "--db", "--actor", "--idempotency-key", "--tenant", "--expect", "--commit"].includes(key))) {
  fail("包含未知参数。支持 --input、--db、--actor、--idempotency-key、--tenant、--expect 和 --commit。");
}
if (!Number.isInteger(expected) || expected < 0) fail("--expect 必须是非负整数。");
if (lstatSync(databasePath).isSymbolicLink()) fail("数据库文件不能是符号链接。");

const bytes = statSync(inputPath).size;
if (bytes < 1 || bytes > MAX_BYTES) fail("数据包必须大于 0 且不超过 16 MB。");
const raw = readFileSync(inputPath, "utf8");
const bundle: unknown = JSON.parse(raw);
const database = new DatabaseSync(databasePath);
database.exec("PRAGMA busy_timeout=5000;");

try {
  const repository = new IntelligenceDiscoveryRepository(database);
  const before = candidateCount(database);
  const preview = repository.previewImport(bundle, {
    tenantId,
    actorId,
    idempotencyKey,
    rawBytes: Buffer.byteLength(raw),
    now: new Date().toISOString(),
  });

  process.stdout.write(`${JSON.stringify({ mode: shouldCommit ? "commit" : "preview", before, preview }, null, 2)}\n`);
  if (preview.errors.length) fail("预检包含无效记录，停止导入。");
  if (preview.duplicates.length) fail("预检发现重复记录，停止导入。");
  if (expected && preview.valid !== expected) fail(`预期 ${expected} 条有效记录，实际为 ${preview.valid} 条。`);
  if (!shouldCommit) process.exit(0);

  const committed = repository.commitImport(preview.importId, {
    tenantId,
    actorId,
    expectedVersion: preview.version,
    now: new Date().toISOString(),
  });
  const inserted = repository.list({ status: "pending_review", limit: 200 }).items
    .filter((candidate) => committed.candidateIds.includes(candidate.id))
    .map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      priority: candidate.priority,
      completeness: candidate.completeness,
      candidateKind: candidate.candidateKind,
      missingFields: candidate.missingFields,
      status: candidate.status,
    }));
  process.stdout.write(`${JSON.stringify({ committed, inserted, after: candidateCount(database), quickCheck: database.prepare("PRAGMA quick_check").get() }, null, 2)}\n`);
} finally {
  database.close();
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) fail(`${name} 不能为空。`);
  return value.trim();
}

function absoluteFile(value: string | undefined, name: string): string {
  const path = required(value, name);
  if (!isAbsolute(path)) fail(`${name} 必须是绝对路径。`);
  const resolved = resolve(path);
  if (!existsSync(resolved) || !lstatSync(resolved).isFile()) fail(`${name} 指向的文件不存在。`);
  return resolved;
}

function candidateCount(database: DatabaseSync): number {
  return Number((database.prepare("SELECT COUNT(*) AS count FROM intelligence_candidates").get() as { count: number }).count);
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
