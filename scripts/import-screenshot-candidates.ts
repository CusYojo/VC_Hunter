/** Screenshots are research leads, never automatic project creation. Default is dry-run. */
import { readFileSync, statSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import { prepareScreenshotCandidates } from "../src/services/screenshot-candidate-import";

async function main() {
  const args = process.argv.slice(2);
  const files = args.filter((arg) => !arg.startsWith("--"));
  if (!files.length || args.some((arg) => arg.startsWith("--") && !/^(--dry-run|--apply|--db=.+|--actor=.+)$/.test(arg))) throw new Error("用法：npx tsx scripts/import-screenshot-candidates.ts <文件.json> [...] [--dry-run]；写入须显式 --apply --db=绝对路径 --actor=操作人。");
  if (args.includes("--apply") && args.includes("--dry-run")) throw new Error("--apply 与 --dry-run 不能同时使用。");
  const rows = files.flatMap((file) => {
    if (!file.toLowerCase().endsWith(".json") || statSync(file).size > 16 * 1024 * 1024) throw new Error("候选文件必须是小于 16 MB 的 JSON。");
    return prepareScreenshotCandidates(JSON.parse(readFileSync(file, "utf8"))).entries.map((entry) => entry.row);
  });
  const prepared = prepareScreenshotCandidates(rows);
  console.log(JSON.stringify({ mode: args.includes("--apply") ? "apply" : "dry-run", files: files.map((file) => basename(file)), ...prepared.summary,
    preview: prepared.entries.map(({ row }) => ({ companyName: row.companyName, eventDate: row.eventDate, track: row.track, round: row.round, amountText: row.amountText, valuation: row.valuation, sourceCount: row.sources.length })) }, null, 2));
  if (!args.includes("--apply")) { console.log("dry-run 通过：未打开数据库。实际导入只写待复核候选，不创建正式项目、不分配负责人。"); return; }
  const dbPath = args.find((arg) => arg.startsWith("--db="))?.slice(5);
  const actor = args.find((arg) => arg.startsWith("--actor="))?.slice(8).trim();
  if (!dbPath || !isAbsolute(dbPath) || !actor) throw new Error("写入必须提供 --db=明确的绝对路径 和 --actor=操作人。");
  const { createDatabase, initializeDatabase } = await import("../src/db/client");
  const { importScreenshotCandidates } = await import("../src/services/screenshot-candidate-import");
  const database = createDatabase(dbPath);
  try { initializeDatabase(database); console.log(JSON.stringify(importScreenshotCandidates(database, rows, { actor }), null, 2)); }
  finally { database.close(); }
}

main().catch((error: unknown) => { console.error(`候选导入失败：${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
