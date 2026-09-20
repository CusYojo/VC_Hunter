import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { TRACK_VALUES, type LeadStatus, type Track } from "@/domain/types";
import { replaceProjectResponsibles } from "@/workbench/project-responsibles";
import { dealStageForProjectStatus, dealStageIdForValue } from "@/workbench/deal-stages";

export interface ProjectTrackingRow {
  sourceRow: number; projectName: string; owner: string | null; members: string[];
  industry: string | null; stage: string | null; latestProgress: string; updatedAt: string;
  nextPlan: string | null; nextPlanUpdatedAt: string | null;
}
export interface ProjectTrackingImportOptions {
  sourceFile: string; sourceSheet: string; sourceSha256: string;
  projectAliases?: Record<string, string>; memberAliases?: Record<string, string>;
  projectTracks?: Record<string, Track>;
}
type Member = { id: string; name: string; isPlaceholder?: boolean };
type PlanEntry = { projectId: string; projectName: string; sourceProjectName: string; sourceRow: number; expectedVersion: number; create: boolean; track: Track; ownerNames: string[]; ownerIds: string[]; placeholderOwners: string[]; latestProgress: string; progressDate: string; stageLabel: string | null; dealStage: string | null; nextStatus?: LeadStatus; industry: string | null; nextPlan: string | null; nextPlanUpdatedAt: string | null; changed: boolean };
export interface ProjectTrackingImportPlan { entries: PlanEntry[]; summary: { rows: number; projects: number; changed: number; unchanged: number } }
const stages: Record<string, LeadStatus> = { 入库:"new", 受理:"researching", 立项:"contacting", 内核:"dd", 投委会:"ic", 交割:"invested" };
const industryTracks: Record<string,Track> = { 半导体:"半导体",具身智能:"具身智能",具身世界模型应用:"具身智能",AI算力:"AI",商业航天:"商业航天",核聚变:"核聚变",生物医药:"生物医药",新材料:"新材料" };
const key = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g," ").toLocaleLowerCase("zh-CN");
const exactDate = (value: string) => {
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`更新日期无效：${value}`);
  const [year,month,day]=match.slice(1).map(Number), date=new Date(Date.UTC(year,month-1,day));
  if (date.getUTCFullYear()!==year || date.getUTCMonth()!==month-1 || date.getUTCDate()!==day) throw new Error(`更新日期无效：${value}`);
  return value;
};
function uniqueMap<T>(values: readonly T[], getName: (item:T)=>string, label:string) {
  const map=new Map<string,T>();
  for (const item of values) { const normalized=key(getName(item)); if (map.has(normalized)) throw new Error(`${label}名称不唯一：${getName(item)}`); map.set(normalized,item); }
  return map;
}
function resolveAlias(raw:string, aliases:Record<string,string>, candidates:Map<string,unknown>, label:string) {
  const target=aliases[raw] ?? raw, match=candidates.get(key(target));
  if (!match) throw new Error(`${label}无法精确匹配：${raw}${aliases[raw] ? ` → ${target}` : ""}`);
  return match;
}
function validateOptions(options: ProjectTrackingImportOptions) {
  if (!options.sourceFile.trim() || options.sourceFile.length>240 || /[/\\\x00-\x1f]/.test(options.sourceFile)) throw new Error("来源文件名无效。");
  if (!options.sourceSheet.trim() || options.sourceSheet.length>120) throw new Error("来源工作表无效。");
  if (!/^[a-f0-9]{64}$/.test(options.sourceSha256)) throw new Error("来源文件摘要无效。");
  if (Object.values(options.projectTracks ?? {}).some(track=>!(TRACK_VALUES as readonly string[]).includes(track))) throw new Error("新项目赛道配置无效。");
}
function stableId(type:string,sourceHash:string,name:string) { const hash=createHash("sha256").update(`${type}:${sourceHash}:${key(name)}`).digest("hex"); return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`; }
export function prepareProjectTrackingImport(db:DatabaseSync, rows:readonly ProjectTrackingRow[], members:readonly Member[], options:ProjectTrackingImportOptions):ProjectTrackingImportPlan {
  validateOptions(options);
  if (!rows.length || rows.length>2000) throw new Error("项目行数无效。");
  const projects=db.prepare("SELECT id,name,track,subtrack,status,executive_summary,technology_stage,deal_stage,version FROM projects").all() as unknown as Array<{id:string;name:string;track:Track;subtrack:string;status:LeadStatus;executive_summary:string;technology_stage:string;deal_stage:string;version:number}>;
  const projectMap=uniqueMap(projects,p=>p.name,"正式项目"), memberMap=uniqueMap(members,m=>m.name,"组织成员");
  const seen=new Set<string>();
  const entries=rows.map(row=>{
    if (!Number.isSafeInteger(row.sourceRow)||row.sourceRow<2||!row.projectName.trim()||row.projectName.length>200||!row.latestProgress.trim()||row.latestProgress.length>10000) throw new Error(`第 ${row.sourceRow} 行项目字段无效。`);
    const canonicalName=options.projectAliases?.[row.projectName] ?? row.projectName.trim();
    const existing=projectMap.get(key(canonicalName));
    const explicitTrack=options.projectTracks?.[row.projectName] ?? options.projectTracks?.[canonicalName];
    const track=existing?.track as Track | undefined ?? explicitTrack ?? industryTracks[row.industry?.trim() ?? ""];
    if (!existing && !track) throw new Error(`新项目缺少明确赛道：${row.projectName}`);
    const project=existing ?? { id:stableId("project",options.sourceSha256,canonicalName),name:canonicalName,status:"new" as LeadStatus,executive_summary:"",technology_stage:"",deal_stage:"contact",subtrack:"",version:0,track:track! };
    if (seen.has(project.id)) throw new Error(`同一正式项目出现多次：${project.name}`); seen.add(project.id);
    const labels=[row.owner,...row.members].filter((value):value is string=>Boolean(value?.trim()));
    const resolved=labels.reduce<Member[]>((ordered,name)=>{
      const member=resolveAlias(name,options.memberAliases??{},memberMap,"负责人") as Member;
      return ordered.some(item=>item.id===member.id) ? ordered : [...ordered,member];
    },[]);
    if (!resolved.length) throw new Error(`项目没有可匹配负责人：${row.projectName}`);
    const progressDate=exactDate(row.updatedAt), nextStatus=row.stage ? stages[row.stage.trim()] : undefined;
    if (row.stage?.trim() && !nextStatus) throw new Error(`项目阶段无法映射：${row.stage}`);
    const currentOwners=existing ? (db.prepare("SELECT member_id FROM project_responsibles WHERE project_id=? ORDER BY position").all(project.id) as unknown as Array<{member_id:string|null}>).map(item=>item.member_id) : [];
    const stageLabel=row.stage?.trim()||null, dealStage=stageLabel ? dealStageIdForValue(stageLabel) ?? (nextStatus ? dealStageForProjectStatus(nextStatus) : undefined) ?? null : null, industry=row.industry?.trim()||null;
    const changed=!existing || project.executive_summary!==row.latestProgress.trim() || (nextStatus!==undefined && project.status!==nextStatus) || (stageLabel!==null && project.technology_stage!==stageLabel) || (dealStage!==null && project.deal_stage!==dealStage) || (industry!==null && project.subtrack!==industry) || JSON.stringify(currentOwners)!==JSON.stringify(resolved.map(member=>member.id));
    return { projectId:project.id,projectName:project.name,sourceProjectName:row.projectName.trim(),sourceRow:row.sourceRow,expectedVersion:project.version,create:!existing,track:track!,ownerNames:resolved.map(member=>member.name),ownerIds:resolved.map(member=>member.id),placeholderOwners:resolved.filter(member=>member.isPlaceholder).map(member=>member.name),latestProgress:row.latestProgress.trim(),progressDate,stageLabel,dealStage,...(nextStatus?{nextStatus}:{}),industry,nextPlan:row.nextPlan?.trim()||null,nextPlanUpdatedAt:row.nextPlanUpdatedAt?exactDate(row.nextPlanUpdatedAt):null,changed };
  });
  return { entries,summary:{rows:rows.length,projects:entries.length,changed:entries.filter(entry=>entry.changed).length,unchanged:entries.filter(entry=>!entry.changed).length} };
}
function requestHash(rows:readonly ProjectTrackingRow[], options:ProjectTrackingImportOptions) { return createHash("sha256").update(JSON.stringify({rows,source:{sourceFile:options.sourceFile,sourceSheet:options.sourceSheet,sourceSha256:options.sourceSha256},projectAliases:options.projectAliases??{},memberAliases:options.memberAliases??{},projectTracks:options.projectTracks??{}})).digest("hex"); }
export function applyProjectTrackingImport(db:DatabaseSync, rows:readonly ProjectTrackingRow[], members:readonly Member[], options:ProjectTrackingImportOptions, actor:string, requestId:string):ProjectTrackingImportPlan {
  if (!actor.trim()||actor.length>128||!requestId.trim()||requestId.length>200) throw new Error("操作人与幂等键无效。");
  const hash=requestHash(rows,options);
  db.exec("BEGIN IMMEDIATE");
  try {
    const prior=db.prepare("SELECT after_json,note FROM audit_log WHERE actor=? AND action='project.tracking_import.batch' AND request_id=?").get(actor,requestId);
    if (prior) { if (String(prior.note)!==hash) throw new Error("幂等键已用于其他导入内容。"); const result=JSON.parse(String(prior.after_json)) as ProjectTrackingImportPlan; db.exec("COMMIT"); return result; }
    const plan=prepareProjectTrackingImport(db,rows,members,options), now=new Date().toISOString();
    for (const entry of plan.entries.filter(item=>item.changed)) {
      const beforeProject=db.prepare("SELECT name,track,subtrack,status,executive_summary,technology_stage,deal_stage,owner,owner_id,latest_event_at,version FROM projects WHERE id=?").get(entry.projectId) ?? null;
      const beforeResponsibles=entry.create ? [] : db.prepare("SELECT member_name,member_id,position FROM project_responsibles WHERE project_id=? ORDER BY position").all(entry.projectId);
      const before=entry.create ? null : { project:beforeProject,responsibles:beforeResponsibles };
      const eventAt=`${entry.progressDate}T00:00:00+08:00`;
      if (entry.create) {
        const companyId=stableId("company",options.sourceSha256,entry.projectName);
        db.prepare("INSERT INTO companies(id,legal_name,aliases_json,official_domain,region_scope) VALUES (?,?,?,NULL,'中国')").run(companyId,entry.projectName,JSON.stringify(entry.sourceProjectName===entry.projectName?[]:[entry.sourceProjectName]));
        db.prepare(`INSERT INTO projects(id,company_id,name,track,subtrack,discovery_at,discovery_reason,status,executive_summary,technology_stage,deal_stage,urgency_score,quality_score,evidence_quality,owner,owner_id,signal_type,latest_event_at,risk_flags_json,open_questions_json,version,last_researched_at,score_urgency,score_quality,score_evidence)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,-1,-1,-1,?,?,?,?,'[]','[]',1,?,NULL,NULL,NULL)`).run(entry.projectId,companyId,entry.projectName,entry.track,entry.industry??"待分类",eventAt,"工作推进表导入",entry.nextStatus??"new",entry.latestProgress,entry.stageLabel??"待评估",entry.dealStage??"contact",entry.ownerNames[0],entry.ownerIds[0],"spreadsheet_import",eventAt,eventAt);
      } else {
        const result=db.prepare(`UPDATE projects SET executive_summary=?,status=COALESCE(?,status),technology_stage=COALESCE(?,technology_stage),deal_stage=COALESCE(?,deal_stage),subtrack=COALESCE(?,subtrack),owner=?,owner_id=?,version=version+1,latest_event_at=? WHERE id=? AND version=?`).run(entry.latestProgress,entry.nextStatus??null,entry.stageLabel,entry.dealStage,entry.industry,entry.ownerNames[0],entry.ownerIds[0],eventAt,entry.projectId,entry.expectedVersion);
        if (Number(result.changes)!==1) throw new Error(`版本冲突：${entry.projectName}`);
      }
      replaceProjectResponsibles(db,entry.projectId,entry.ownerNames.map((name,index)=>({name,id:entry.ownerIds[index]})),now);
      const afterProject=db.prepare("SELECT name,track,subtrack,status,executive_summary,technology_stage,deal_stage,owner,owner_id,latest_event_at,version FROM projects WHERE id=?").get(entry.projectId);
      const afterResponsibles=db.prepare("SELECT member_name,member_id,position FROM project_responsibles WHERE project_id=? ORDER BY position").all(entry.projectId);
      const provenance={ source:{sourceFile:options.sourceFile,sourceSheet:options.sourceSheet,sourceSha256:options.sourceSha256}, sourceRow:entry.sourceRow,sourceProjectName:entry.sourceProjectName,progressDate:entry.progressDate,stageLabel:entry.stageLabel,industry:entry.industry,latestProgress:entry.latestProgress,nextPlan:entry.nextPlan,nextPlanUpdatedAt:entry.nextPlanUpdatedAt,owners:entry.ownerNames,version:entry.create?1:entry.expectedVersion+1,created:entry.create,project:afterProject,responsibles:afterResponsibles };
      db.prepare("INSERT INTO audit_log(id,actor,action,resource_type,resource_id,before_json,after_json,note,request_id,created_at) VALUES (?,?,?,'project',?,?,?,?,?,?)").run(randomUUID(),actor,entry.create?"project.tracking_created":"project.tracking_imported",entry.projectId,JSON.stringify(before),JSON.stringify(provenance),`从 ${options.sourceFile} 第 ${entry.sourceRow} 行导入`,`${requestId}:${entry.projectId}`,now);
      db.prepare("INSERT INTO platform_timeline(id,event_type,subject_type,subject_id,project_id,actor,summary,metadata_json,trace_id,created_at) VALUES (?,'project.tracking_imported','project',?,?,?,?,?,?,?)").run(randomUUID(),entry.projectId,entry.projectId,actor,"从工作推进表更新负责人和项目进度",JSON.stringify({sourceFile:options.sourceFile,sourceSheet:options.sourceSheet,sourceSha256:options.sourceSha256,sourceRow:entry.sourceRow,progressDate:entry.progressDate}),requestId,now);
    }
    db.prepare("INSERT INTO audit_log(id,actor,action,resource_type,resource_id,before_json,after_json,note,request_id,created_at) VALUES (?,?, 'project.tracking_import.batch','project_import',?,'null',?,?,?,?)").run(randomUUID(),actor,options.sourceSha256,JSON.stringify(plan),hash,requestId,now);
    db.exec("COMMIT"); return plan;
  } catch(error) { db.exec("ROLLBACK"); throw error; }
}
