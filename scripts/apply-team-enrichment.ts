import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { applyTeamEnrichments, type TeamEnrichment } from "./team-enrichment-lib";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`缺少参数 ${name}`);
  return value;
}

const databasePath = argument("--db");
const inputPath = argument("--input");
const input = JSON.parse(readFileSync(inputPath, "utf8")) as TeamEnrichment[];
if (!Array.isArray(input)) throw new Error("团队补充文件必须是数组");

const database = new DatabaseSync(databasePath);
try {
  database.exec("PRAGMA foreign_keys=ON");
  const result = applyTeamEnrichments(database, input, new Date().toISOString());
  console.log(JSON.stringify({ ...result, total: input.length }));
} finally {
  database.close();
}
