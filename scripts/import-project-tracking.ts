/**
 * Safe project tracking workbook import. Dry-run is mandatory before an explicit apply.
 * Example: npx tsx scripts/import-project-tracking.ts workbook.xlsx --dry-run --db=/absolute/review.db --organization-db=/absolute/auth.db --tenant=workspace --aliases=/absolute/aliases.json
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, statSync } from "node:fs";
import { basename, extname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { TRACK_VALUES, type Track } from "../src/domain/types";
import { applyProjectTrackingImport, prepareProjectTrackingImport, type ProjectTrackingImportOptions, type ProjectTrackingRow } from "../src/services/project-tracking-import";
const option=(args:string[],name:string)=>args.find(arg=>arg.startsWith(`${name}=`))?.slice(name.length+1);
function safeExisting(path:string,label:string) { if (!isAbsolute(path)||lstatSync(path).isSymbolicLink()||!statSync(path).isFile()) throw new Error(`${label}必须是已存在的绝对普通文件，不能是符号链接。`); }
function stringMap(value:unknown,label:string) {
  if (value===undefined) return {};
  if (!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length>200) throw new Error(`${label}无效。`);
  const entries=Object.entries(value);
  if (entries.some(([key,value])=>!key.trim()||key.length>200||typeof value!=="string"||!value.trim()||value.length>200)) throw new Error(`${label}无效。`);
  return Object.fromEntries(entries) as Record<string,string>;
}
async function main() {
  const args=process.argv.slice(2), files=args.filter(arg=>!arg.startsWith("--"));
  const allowed=/^(--dry-run|--apply|--db=.+|--organization-db=.+|--tenant=.+|--actor=.+|--request-id=.+|--aliases=.+|--expected-count=\d+|--source-sha256=[a-f0-9]{64})$/;
  if (files.length!==1||args.some(arg=>arg.startsWith("--")&&!allowed.test(arg))||args.includes("--dry-run")===args.includes("--apply")) throw new Error("须选择 --dry-run 或 --apply，并提供一个 .xlsx、明确数据库、组织库及工作空间参数。");
  const file=files[0]; safeExisting(file,"工作簿");
  if (extname(file).toLowerCase()!==".xlsx"||statSync(file).size>32*1024*1024) throw new Error("仅支持不超过32 MB的XLSX工作簿。");
  const dbPath=option(args,"--db"), organizationPath=option(args,"--organization-db"), tenant=option(args,"--tenant")?.trim();
  if (!dbPath||!organizationPath||!tenant||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(tenant)) throw new Error("必须提供 --db、--organization-db 绝对路径和有效 --tenant。");
  safeExisting(dbPath,"项目数据库"); safeExisting(organizationPath,"组织数据库");
  const bytes=readFileSync(file), sourceSha256=createHash("sha256").update(bytes).digest("hex");
  const extracted=JSON.parse(execFileSync(process.env.VC_HUNTER_XLSX_PYTHON||"python3",[fileURLToPath(new URL("./extract-project-tracking-xlsx.py",import.meta.url)),file],{encoding:"utf8",maxBuffer:16*1024*1024,timeout:30000})) as {sourceSheet:string;otherSheets:string[];items:ProjectTrackingRow[]};
  const count=option(args,"--expected-count"); if (count&&Number(count)!==extracted.items.length) throw new Error(`预期${count}行，实际${extracted.items.length}行；禁止继续。`);
  const dry=args.includes("--dry-run"), actor=option(args,"--actor")?.trim(), requestId=option(args,"--request-id")?.trim(), confirmed=option(args,"--source-sha256");
  if (!dry && (!actor||!requestId||confirmed!==sourceSha256||!count)) throw new Error("写入必须提供actor、request-id、expected-count及匹配的source-sha256确认值。");
  const aliasesPath=option(args,"--aliases"); let aliases:unknown={};
  if (aliasesPath) { safeExisting(aliasesPath,"别名配置"); aliases=JSON.parse(readFileSync(aliasesPath,"utf8")); }
  if (!aliases||typeof aliases!=="object"||Array.isArray(aliases)||Object.keys(aliases).some(key=>!["projectAliases","memberAliases","projectTracks"].includes(key))) throw new Error("别名配置只能包含projectAliases、memberAliases和projectTracks。");
  const projectAliases=stringMap((aliases as Record<string,unknown>).projectAliases,"项目别名"), memberAliases=stringMap((aliases as Record<string,unknown>).memberAliases,"成员别名");
  const rawTracks=stringMap((aliases as Record<string,unknown>).projectTracks,"项目赛道");
  if (Object.values(rawTracks).some(track=>!(TRACK_VALUES as readonly string[]).includes(track))) throw new Error("项目赛道必须使用平台正式赛道。");
  const projectTracks=rawTracks as Record<string,Track>;
  const org=new DatabaseSync(organizationPath,{readOnly:true});
  const members=(org.prepare(`SELECT p.id,p.name,p.is_placeholder FROM organization_members p LEFT JOIN workspace_memberships m ON m.team_user_id=p.id AND m.tenant_id=p.tenant_id WHERE p.tenant_id=? AND p.active=1 AND (p.is_placeholder=1 OR (p.account_id IS NOT NULL AND m.active=1)) ORDER BY p.id`).all(tenant) as unknown as {id:string;name:string;is_placeholder:number}[]).map(member=>({id:member.id,name:member.name,isPlaceholder:Boolean(member.is_placeholder)})); org.close();
  if (!members.length) throw new Error("指定工作空间没有可分配的有效成员。");
  const options:ProjectTrackingImportOptions={sourceFile:basename(file),sourceSheet:extracted.sourceSheet,sourceSha256,projectAliases,memberAliases,projectTracks};
  const dbModule=dry?null:await import("../src/db/client"), projectDb=dry?new DatabaseSync(dbPath,{readOnly:true}):dbModule!.createDatabase(dbPath);
  try {
    if (!dry) dbModule!.initializeDatabase(projectDb);
    const result=dry?prepareProjectTrackingImport(projectDb,extracted.items,members,options):applyProjectTrackingImport(projectDb,extracted.items,members,options,actor!,requestId!);
    console.log(JSON.stringify({mode:dry?"dry-run":"apply",sourceFile:basename(file),sourceSha256,sourceSheet:extracted.sourceSheet,otherSheetCount:extracted.otherSheets.length,...result.summary,createCount:result.entries.filter(entry=>entry.create).length,updateCount:result.entries.filter(entry=>!entry.create&&entry.changed).length,placeholderOwners:[...new Set(result.entries.flatMap(entry=>entry.placeholderOwners))],preview:result.entries.map(entry=>({sourceRow:entry.sourceRow,sourceProjectName:entry.sourceProjectName,projectName:entry.projectName,create:entry.create,track:entry.track,owners:entry.ownerNames,placeholderOwners:entry.placeholderOwners,progressDate:entry.progressDate,stage:entry.stageLabel,changed:entry.changed}))},null,2));
    if (dry) console.log("dry-run完成：数据库以只读模式打开，没有写入任何项目、负责人或审计记录。");
  } finally { projectDb.close(); }
}
main().catch(error=>{console.error(`导入失败：${error instanceof Error?error.message:String(error)}`);process.exitCode=1;});
