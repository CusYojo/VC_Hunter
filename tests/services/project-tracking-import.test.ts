import { beforeEach, afterEach, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { prepareProjectTrackingImport, applyProjectTrackingImport, type ProjectTrackingRow } from "@/services/project-tracking-import";
let db: DatabaseSync;
const members = [{ id: "m-owner", name: "黄昕" }, { id: "m-one", name: "余勤" }, { id: "m-two", name: "国袭明" }, { id: "m-placeholder", name: "康文斌", isPlaceholder: true }];
const source = { sourceFile: "推进表.xlsx", sourceSheet: "总表", sourceSha256: "a".repeat(64) };
const rows: ProjectTrackingRow[] = [
  { sourceRow: 2, projectName: "源项目甲", owner: "黄总", members: ["余勤", "国袭明"], industry: "半导体", stage: "投委会", latestProgress: "投决材料已经定稿", updatedAt: "2026-08-03", nextPlan: "推进协议", nextPlanUpdatedAt: "2026-08-03" },
  { sourceRow: 3, projectName: "项目乙", owner: "余勤", members: [], industry: null, stage: "受理", latestProgress: "完成首次交流", updatedAt: "2026-08-02", nextPlan: null, nextPlanUpdatedAt: "2026-08-02" },
];
beforeEach(() => { db=createDatabase(":memory:"); initializeDatabase(db); seedDemoData(db); db.prepare("UPDATE projects SET name='源项目甲',owner=NULL WHERE id='project-qiongxin'").run(); db.prepare("UPDATE projects SET name='正式项目乙',owner=NULL WHERE id='project-bianjie'").run(); });
afterEach(() => db.close());
it("previews exact and explicitly aliased matches without writing", () => {
  const before = db.prepare("SELECT version,executive_summary FROM projects WHERE id='project-qiongxin'").get();
  const plan=prepareProjectTrackingImport(db, rows, members, { ...source, projectAliases: { 项目乙:"正式项目乙" }, memberAliases:{ 黄总:"黄昕" } });
  expect(plan.summary).toEqual({ rows:2,projects:2,changed:2,unchanged:0 });
  expect(plan.entries[0]).toMatchObject({ projectId:"project-qiongxin", projectName:"源项目甲", expectedVersion:1, ownerNames:["黄昕","余勤","国袭明"], nextStatus:"ic" });
  expect(db.prepare("SELECT version,executive_summary FROM projects WHERE id='project-qiongxin'").get()).toEqual(before);
  expect(db.prepare("SELECT count(*) n FROM audit_log WHERE action LIKE 'project.tracking_import%'").get()?.n).toBe(0);
});
it("deduplicates people after resolving member aliases while preserving owner order", () => {
  const plan=prepareProjectTrackingImport(db,[{...rows[0],owner:"黄总",members:["黄昕","余勤"]}],members,{...source,memberAliases:{黄总:"黄昕"}});
  expect(plan.entries[0]).toMatchObject({ownerNames:["黄昕","余勤"],ownerIds:["m-owner","m-one"]});
});
it("maps a workbook display label onto the canonical project name", () => {
  db.prepare("UPDATE projects SET name='微纳核芯',track='半导体' WHERE id='project-qiongxin'").run();
  const plan=prepareProjectTrackingImport(db,[{...rows[0],projectName:"微纳核心 65亿（交投基金）",owner:"余勤",members:[]}],members,{...source,projectAliases:{"微纳核心 65亿（交投基金）":"微纳核芯"}});
  expect(plan.entries[0]).toMatchObject({projectId:"project-qiongxin",projectName:"微纳核芯",sourceProjectName:"微纳核心 65亿（交投基金）",create:false});
});
it("atomically updates progress, stage and responsible members with source-level audit", () => {
  const result=applyProjectTrackingImport(db,rows,members,{...source,projectAliases:{项目乙:"正式项目乙"},memberAliases:{黄总:"黄昕"}},"admin","request-1");
  expect(result.summary).toEqual({rows:2,projects:2,changed:2,unchanged:0});
  expect(db.prepare("SELECT executive_summary,status,technology_stage,deal_stage,subtrack,owner,owner_id,version FROM projects WHERE id='project-qiongxin'").get()).toEqual({ executive_summary:"投决材料已经定稿",status:"ic",technology_stage:"投委会",deal_stage:"ic",subtrack:"半导体",owner:"黄昕",owner_id:"m-owner",version:2 });
  expect(db.prepare("SELECT latest_event_at FROM projects WHERE id='project-qiongxin'").get()?.latest_event_at).toBe("2026-08-03T00:00:00+08:00");
  expect(db.prepare("SELECT member_name name,member_id id,position FROM project_responsibles WHERE project_id='project-qiongxin' ORDER BY position").all()).toEqual([{name:"黄昕",id:"m-owner",position:0},{name:"余勤",id:"m-one",position:1},{name:"国袭明",id:"m-two",position:2}]);
  const audit=db.prepare("SELECT after_json,note FROM audit_log WHERE action='project.tracking_imported' AND resource_id='project-qiongxin'").get();
  expect(JSON.parse(String(audit?.after_json))).toMatchObject({ source, sourceRow:2, progressDate:"2026-08-03", stageLabel:"投委会", latestProgress:"投决材料已经定稿", project:{technology_stage:"投委会",subtrack:"半导体",latest_event_at:"2026-08-03T00:00:00+08:00"}, responsibles:[{member_id:"m-owner"},{member_id:"m-one"},{member_id:"m-two"}] });
  expect(JSON.parse(String(db.prepare("SELECT before_json FROM audit_log WHERE action='project.tracking_imported' AND resource_id='project-qiongxin'").get()?.before_json))).toMatchObject({project:{technology_stage:"customer_qualification",subtrack:"先进封装",version:1},responsibles:[]});
  expect(String(audit?.note)).toContain("推进表.xlsx");
  const timeline=db.prepare("SELECT metadata_json FROM platform_timeline WHERE event_type='project.tracking_imported' AND project_id='project-qiongxin'").get();
  expect(JSON.parse(String(timeline?.metadata_json))).toMatchObject({ sourceSha256:source.sourceSha256, sourceSheet:"总表", sourceRow:2, progressDate:"2026-08-03" });
  expect(db.prepare("SELECT subtrack FROM projects WHERE id='project-bianjie'").get()?.subtrack).toBe("灵巧手与数据采集");
});
it("creates a missing formal project only with an explicit or source-mapped track",()=>{
  const row={...rows[0],sourceRow:8,projectName:"全新项目",owner:"余勤",members:[],industry:null,stage:"受理"};
  expect(()=>prepareProjectTrackingImport(db,[row],members,source)).toThrow(/明确赛道/);
  const options={...source,projectAliases:{全新项目:"全新项目正式名"},projectTracks:{全新项目:"AI" as const}};
  const preview=prepareProjectTrackingImport(db,[row],members,options); expect(preview.entries[0]).toMatchObject({create:true,expectedVersion:0,projectName:"全新项目正式名",nextStatus:"researching"});
  const saved=applyProjectTrackingImport(db,[row],members,options,"admin","create-new");
  const project=db.prepare("SELECT name,track,subtrack,technology_stage,deal_stage,status,version,latest_event_at FROM projects WHERE id=?").get(saved.entries[0].projectId);
  expect(project).toEqual({name:"全新项目正式名",track:"AI",subtrack:"待分类",technology_stage:"受理",deal_stage:"initiation",status:"researching",version:1,latest_event_at:"2026-08-03T00:00:00+08:00"});
  expect(db.prepare("SELECT aliases_json FROM companies WHERE id=(SELECT company_id FROM projects WHERE id=?)").get(saved.entries[0].projectId)?.aliases_json).toBe('["全新项目"]');
  expect(db.prepare("SELECT action FROM audit_log WHERE resource_id=? AND action='project.tracking_created'").get(saved.entries[0].projectId)?.action).toBe("project.tracking_created");
});
it("stores a new project's source industry as its subtrack",()=>{
  const row={...rows[0],projectName:"新具身项目",owner:"余勤",members:[],industry:"具身世界模型应用",stage:"立项"};
  const saved=applyProjectTrackingImport(db,[row],members,source,"admin","new-industry");
  expect(db.prepare("SELECT track,subtrack,technology_stage,status FROM projects WHERE id=?").get(saved.entries[0].projectId)).toEqual({track:"具身智能",subtrack:"具身世界模型应用",technology_stage:"立项",status:"contacting"});
});
it("preserves an active placeholder responsibility and marks it for later account activation",()=>{
  const row={...rows[0],owner:"余勤",members:["康文斌"]};
  const plan=prepareProjectTrackingImport(db,[row],members,source);
  expect(plan.entries[0]).toMatchObject({ownerNames:["余勤","康文斌"],ownerIds:["m-one","m-placeholder"],placeholderOwners:["康文斌"]});
});
it("replays an identical batch safely and rejects key reuse for changed source", () => {
  const options={...source,projectAliases:{项目乙:"正式项目乙"},memberAliases:{黄总:"黄昕"}};
  const first=applyProjectTrackingImport(db,rows,members,options,"admin","same");
  expect(applyProjectTrackingImport(db,rows,members,options,"admin","same")).toEqual(first);
  expect(db.prepare("SELECT version FROM projects WHERE id='project-qiongxin'").get()?.version).toBe(2);
  expect(db.prepare("SELECT count(*) n FROM audit_log WHERE action='project.tracking_import.batch'").get()?.n).toBe(1);
  expect(()=>applyProjectTrackingImport(db,[{...rows[0],latestProgress:"被改变"},rows[1]],members,options,"admin","same")).toThrow(/幂等键/);
});
it("reports a later identical import as unchanged without incrementing project versions",()=>{
  const options={...source,projectAliases:{项目乙:"正式项目乙"},memberAliases:{黄总:"黄昕"}};
  applyProjectTrackingImport(db,rows,members,options,"admin","first-pass");
  const second=applyProjectTrackingImport(db,rows,members,options,"admin","second-pass");
  expect(second.summary).toEqual({rows:2,projects:2,changed:0,unchanged:2});
  expect(db.prepare("SELECT version FROM projects WHERE id='project-qiongxin'").get()?.version).toBe(2);
  db.prepare("UPDATE projects SET technology_stage='旧阶段' WHERE id='project-qiongxin'").run();
  expect(prepareProjectTrackingImport(db,rows,members,options).entries[0].changed).toBe(true);
  db.prepare("UPDATE projects SET technology_stage='投委会',subtrack='旧行业' WHERE id='project-qiongxin'").run();
  expect(prepareProjectTrackingImport(db,rows,members,options).entries[0].changed).toBe(true);
});
it("validates source metadata, duplicate directory names and optional stages",()=>{
  expect(()=>prepareProjectTrackingImport(db,[rows[0]],members,{...source,sourceSha256:"bad"})).toThrow(/摘要/);
  expect(()=>prepareProjectTrackingImport(db,[rows[0]],[...members,{id:"duplicate",name:"余勤"}],source)).toThrow(/成员名称不唯一/);
  db.prepare("UPDATE projects SET name='源项目甲' WHERE id='project-bianjie'").run();
  expect(()=>prepareProjectTrackingImport(db,[rows[0]],members,source)).toThrow(/项目名称不唯一/);
  db.prepare("UPDATE projects SET name='恢复项目乙' WHERE id='project-bianjie'").run();
  const noStage=prepareProjectTrackingImport(db,[{...rows[0],stage:null}],members,{...source,memberAliases:{黄总:"黄昕"}});
  expect(noStage.entries[0].nextStatus).toBeUndefined();
});
it.each([
  ["unmatched member", rows, {projectAliases:{项目乙:"正式项目乙"},memberAliases:{}}],
  ["unmatched project", rows, {memberAliases:{黄总:"黄昕"}}],
  ["duplicate project", [rows[0],{...rows[0],sourceRow:4}], {projectAliases:{项目乙:"正式项目乙"},memberAliases:{黄总:"黄昕"}}],
  ["invalid date", [{...rows[0],updatedAt:"202600706"}], {memberAliases:{黄总:"黄昕"}}],
] as const)("rejects %s and never partially changes projects",(_label,input,mapping)=>{
  expect(()=>prepareProjectTrackingImport(db,input as ProjectTrackingRow[],members,{...source,...mapping})).toThrow();
  expect(db.prepare("SELECT version FROM projects WHERE id='project-qiongxin'").get()?.version).toBe(1);
});
it("rolls back every project, owner and audit when a later write fails",()=>{
  db.exec("CREATE TRIGGER fail_second_import BEFORE UPDATE ON projects WHEN OLD.id='project-bianjie' BEGIN SELECT RAISE(ABORT,'write failure'); END");
  expect(()=>applyProjectTrackingImport(db,rows,members,{...source,projectAliases:{项目乙:"正式项目乙"},memberAliases:{黄总:"黄昕"}},"admin","rollback")).toThrow();
  expect(db.prepare("SELECT version FROM projects WHERE id='project-qiongxin'").get()?.version).toBe(1);
  expect(db.prepare("SELECT count(*) n FROM project_responsibles WHERE project_id='project-qiongxin'").get()?.n).toBe(0);
  expect(db.prepare("SELECT count(*) n FROM audit_log WHERE action LIKE 'project.tracking_import%'").get()?.n).toBe(0);
});
