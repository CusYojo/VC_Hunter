import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { candidateBundleSchema } from "../src/intelligence/contracts";

const MAX_BYTES = 16 * 1024 * 1024;
const inputPath = process.argv[2];

if (!inputPath) fail("用法：npm run intelligence:validate -- <数据包.json>");

const filePath = resolve(inputPath);
const bytes = statSync(filePath).size;
if (bytes > MAX_BYTES) fail(`数据包为 ${bytes} 字节，超过 16 MB 限制。`);

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(filePath, "utf8"));
} catch (error) {
  fail(`无法解析 JSON：${error instanceof Error ? error.message : "未知错误"}`);
}

const result = candidateBundleSchema.safeParse(raw);
if (!result.success) {
  const messages = result.error.issues.map((issue) => `${issue.path.join(".") || "数据包"}: ${issue.message}`);
  fail(`数据包校验失败：\n- ${messages.join("\n- ")}`);
}

const counts = result.data.items.reduce((current, item) => ({ ...current, [item.entityType]: current[item.entityType] + 1 }), { company: 0, person: 0, technology: 0 });
process.stdout.write(`校验通过：${result.data.items.length} 条（公司 ${counts.company}、人才 ${counts.person}、技术 ${counts.technology}），${bytes} 字节。\n`);

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
