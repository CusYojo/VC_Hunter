/**
 * Institution-only import. Safe default: validate and preview, never open a DB.
 * npx tsx scripts/import-investors.ts <.xlsx|.csv|.json> --dry-run [--expected-count=300]
 * Explicit writes: --apply --db=/absolute/path/to/reviewed.db --actor=operator
 * XLSX only reads 300家机构总表 (expects 300 unique institutions); other sheets are ignored.
 * Python executable can be set with VC_HUNTER_XLSX_PYTHON; only standard library is used.
 */
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { basename, extname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { parseInvestorCsv, parseInvestorJson, prepareInvestorImport } from "../src/services/investor-import";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const files = args.filter((arg) => !arg.startsWith("--"));
  const allowed = /^(--dry-run|--apply|--actor=.+|--expected-count=\d+|--db=.+)$/;
  if (files.length !== 1 || args.some((arg) => arg.startsWith("--") && !allowed.test(arg))) throw new Error("用法：npx tsx scripts/import-investors.ts <.xlsx|.csv|.json> [--dry-run] [--expected-count=300]；写入须显式 --apply --db=绝对路径 --actor=操作人。");
  if (args.includes("--dry-run") && args.includes("--apply")) throw new Error("--dry-run 与 --apply 不能同时使用。");
  const filePath = files[0];
  if (statSync(filePath).size > 32 * 1024 * 1024) throw new Error("输入文件超出 32 MB 限制。");
  const extension = extname(filePath).toLowerCase();
  if (![".xlsx", ".csv", ".json"].includes(extension)) throw new Error("仅支持 .xlsx、.csv、.json。");
  const file = readFileSync(filePath);
  const sourceSha256 = createHash("sha256").update(file).digest("hex");
  let sourceSheet: string | undefined;
  let ignoredSheets: string[] = [];
  let json = file.toString("utf8");
  if (extension === ".xlsx") {
    json = execFileSync(process.env.VC_HUNTER_XLSX_PYTHON || "python3", [fileURLToPath(new URL("./extract-investors-xlsx.py", import.meta.url)), filePath], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 30000 });
    const metadata = JSON.parse(json) as { sourceSheet: string; ignoredSheets: string[] };
    sourceSheet = metadata.sourceSheet;
    ignoredSheets = metadata.ignoredSheets;
  }
  const countOption = args.find((arg) => arg.startsWith("--expected-count="));
  const expectedCount = countOption ? Number(countOption.slice("--expected-count=".length)) : extension === ".xlsx" ? 300 : undefined;
  if (expectedCount !== undefined && (!Number.isSafeInteger(expectedCount) || expectedCount < 1)) throw new Error("expected-count 必须是正整数。");
  const rows = extension === ".csv" ? parseInvestorCsv(json) : parseInvestorJson(json);
  const result = prepareInvestorImport(rows, { sourceFile: basename(filePath), sourceSheet, sourceSha256, expectedCount });
  console.log(JSON.stringify({ mode: args.includes("--apply") ? "apply" : "dry-run", sourceFile: basename(filePath), sourceSha256, sourceSheet, ignoredSheets, ...result.summary,
    warningCount: result.warnings.length, warnings: result.warnings, preview: result.entries.slice(0, 3) }, null, 2));
  if (!args.includes("--apply")) {
    console.log("dry-run 校验通过：未打开、未写入任何数据库；未创建项目或投资事件。");
    return;
  }
  const dbPath = args.find((arg) => arg.startsWith("--db="))?.slice(5);
  const actor = args.find((arg) => arg.startsWith("--actor="))?.slice(8).trim();
  if (!dbPath || !isAbsolute(dbPath) || !actor) throw new Error("写入必须提供 --db=明确的绝对路径 和 --actor=操作人；不使用默认正式库。");
  // Load DB modules only after all rows validate and explicit write arguments are present.
  const { createDatabase, initializeDatabase } = await import("../src/db/client");
  const { SqliteInvestorDirectoryRepository } = await import("../src/repositories/investor-directory");
  const database = createDatabase(dbPath);
  try {
    initializeDatabase(database);
    const imported = new SqliteInvestorDirectoryRepository(database).upsertMany(result.entries, actor);
    console.log(`机构导入完成：新增 ${imported.inserted}，补空更新 ${imported.updated}，跳过 ${imported.skipped}。已有非空信息不覆盖；请人工复核状态/优先级冲突。`);
  } finally { database.close(); }
}

main().catch((error: unknown) => {
  console.error(`导入失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
