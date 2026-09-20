import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { projectAssistantMigration } from "@/ai/project-assistant-migration";
import { createProjectAssistantRun, getProjectAssistantView } from "@/ai/project-assistant";
let db: DatabaseSync;
const owner = { tenantId:"tenant",accountId:"alice" };
const projectId = "project-qiongxin";
beforeEach(()=>{db=createDatabase(":memory:");initializeDatabase(db);seedDemoData(db);if(!db.prepare("SELECT name FROM sqlite_master WHERE name='project_assistant_runs'").get())db.exec(projectAssistantMigration.upSql);});
afterEach(()=>{db.close();vi.unstubAllEnvs();});
function knowledge(id:string,project=projectId,content="客户验证进度：已完成第一阶段。",status="approved") {
  db.prepare("INSERT INTO knowledge_entries(id,project_id,track,type,title,content,source_type,source_id,status,version,created_by,created_at,updated_at) VALUES (?,?,'半导体','research',?,?, 'evidence','local',?,1,'author','2026-09-04','2026-09-04')").run(id,project,id,content,status);
}
function gateway() {return {provider:"openai",model:"fixture",generateText:vi.fn().mockResolvedValue({text:"客户已完成第一阶段验证。[S1]",lineage:{actualModel:"fixture",usage:{inputTokens:10,outputTokens:8}}})};}
it("answers only from the current project's available knowledge with private history and stable replay",async()=>{
  knowledge("current");knowledge("other","project-xinglan","不应泄露其他项目内容");knowledge("rejected",projectId,"不应泄露被拒绝资料","rejected");
  const model=gateway();
  const result=await createProjectAssistantRun(db,owner,projectId,{prompt:"客户验证进展？",consent:true},"key",()=>model);
  expect(result.status).toBe("succeeded");expect(result.sources).toHaveLength(1);expect(result.sources[0].reference).toBe("S1");
  const sent=model.generateText.mock.calls[0][0];expect(sent.user).toContain("已完成第一阶段");expect(sent.user).not.toContain("不应泄露");expect(sent.system).toContain("不可信");
  expect((await createProjectAssistantRun(db,owner,projectId,{prompt:"客户验证进展？",consent:true},"key",()=>model)).id).toBe(result.id);
  expect(model.generateText).toHaveBeenCalledTimes(1);
  expect(getProjectAssistantView(db,{...owner,accountId:"bob"},projectId).runs).toHaveLength(0);
  expect(getProjectAssistantView(db,owner,projectId).runs).toHaveLength(1);
  await expect(createProjectAssistantRun(db,owner,projectId,{prompt:"changed",consent:true},"key",()=>model)).rejects.toThrow(/幂等/);
});
it("does not call a model without project knowledge or explicit consent",async()=>{
  const model=gateway();
  await expect(createProjectAssistantRun(db,owner,projectId,{prompt:"什么进展？",consent:false},"none",()=>model)).rejects.toThrow();
  const empty=await createProjectAssistantRun(db,owner,projectId,{prompt:"什么进展？",consent:true},"empty",()=>model);expect(empty.status).toBe("failed");expect(empty.error).toMatch(/可用/);
  expect(model.generateText).not.toHaveBeenCalled();
});
it("masks model failures and does not bill again on a failed request replay",async()=>{
  knowledge("current");const model=gateway();model.generateText.mockRejectedValue(new Error("SECRET_KEY raw upstream body"));
  const result=await createProjectAssistantRun(db,owner,projectId,{prompt:"客户？",consent:true},"failure",()=>model);
  expect(result.status).toBe("failed");expect(JSON.stringify(result)).not.toContain("SECRET_KEY");
  await createProjectAssistantRun(db,owner,projectId,{prompt:"客户？",consent:true},"failure",()=>model);expect(model.generateText).toHaveBeenCalledTimes(1);
});

it("retrieves relevant evidence beyond the first 25000 characters and identifies unreviewed drafts",async()=>{
 knowledge("long",projectId,"普通资料。".repeat(6000)+"尾部可靠性测试结论：高温验证已通过，故障率为零。","draft");
 const model=gateway();
 await createProjectAssistantRun(db,owner,projectId,{prompt:"尾部可靠性测试结论是什么？",consent:true},"tail",()=>model);
 const sent=model.generateText.mock.calls[0][0];
 expect(sent.user).toContain("高温验证已通过");expect(sent.user).toContain("待审核");expect(sent.user.length).toBeLessThan(40000);
});

it("reads a newly uploaded local TXT immediately and exposes a safe original-file citation",async()=>{
 const {mkdtemp,rm}=await import("node:fs/promises");const {tmpdir}=await import("node:os");const {join}=await import("node:path");
 const {uploadProjectDocument}=await import("@/workbench/documents");const root=await mkdtemp(join(tmpdir(),"project-ai-"));
 try{
  const version=Number(db.prepare("SELECT version FROM projects WHERE id=?").get(projectId)?.version);
  const doc=await uploadProjectDocument(db,{projectId,expectedVersion:version,name:"项目知识问答验证.txt",mimeType:"text/plain",bytes:Buffer.from("本项目专属验证资料：工程样机已于六月完成验证，下一步进行可靠性测试。"),externalPolicy:"local_only",actorId:"alice",idempotencyKey:"upload",storageRoot:root});
  const before=getProjectAssistantView(db,owner,projectId);expect(before.sources[0].availability).toBe("pending");expect(JSON.stringify(before)).not.toContain(root);
  const model=gateway();const result=await createProjectAssistantRun(db,owner,projectId,{prompt:"项目知识问答验证：工程样机验证进度？",consent:true},"immediate",()=>model,{storageRoot:root});
  expect(result.status).toBe("succeeded");expect(model.generateText.mock.calls[0][0].user).toContain("下一步进行可靠性测试");expect(result.sources[0].href).toBe(`/api/v1/projects/${projectId}/documents/${doc.id}/content?download=1`);
  expect(db.prepare("SELECT external_policy FROM project_documents WHERE id=?").get(doc.id)?.external_policy).toBe("local_only");
  await rm(root,{recursive:true,force:true});
  const degraded=await createProjectAssistantRun(db,owner,projectId,{prompt:"项目知识问答验证？",consent:true},"missing",()=>model,{storageRoot:root});
  expect(degraded.status).toBe("failed");expect(degraded.warnings.join(" ")).toContain("无法解析");expect(JSON.stringify(degraded)).not.toContain(root);expect(model.generateText).toHaveBeenCalledTimes(1);
 }finally{await rm(root,{recursive:true,force:true});}
});
it("allows only one running request per account and replays an in-flight key",async()=>{
 knowledge("current");knowledge("second","project-xinglan");
 let finish!: (value:Awaited<ReturnType<ReturnType<typeof gateway>["generateText"]>>)=>void;
 const model=gateway();model.generateText.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=createProjectAssistantRun(db,owner,projectId,{prompt:"客户？",consent:true},"running",()=>model);
 await vi.waitFor(()=>expect(model.generateText).toHaveBeenCalledTimes(1));
 const replay=await createProjectAssistantRun(db,owner,projectId,{prompt:"客户？",consent:true},"running",()=>model);expect(replay.status).toBe("running");
 await expect(createProjectAssistantRun(db,owner,"project-xinglan",{prompt:"客户？",consent:true},"parallel",()=>model)).rejects.toThrow(/执行中/);
 const bob=gateway();expect((await createProjectAssistantRun(db,{...owner,accountId:"bob"},projectId,{prompt:"客户？",consent:true},"running",()=>bob)).status).toBe("succeeded");
 finish({text:"完成 [S1]",lineage:{actualModel:"fixture",usage:{}}});expect((await pending).status).toBe("succeeded");
 expect(model.generateText).toHaveBeenCalledTimes(1);
});
it("returns a persisted known failure and lets a new key retry after configuration is fixed",async()=>{
 knowledge("current");const {PersonalAIRequiredError}=await import("@/ai/personal-model");
 const failed=await createProjectAssistantRun(db,owner,projectId,{prompt:"客户？",consent:true},"not-configured",()=>{throw new PersonalAIRequiredError();});
 expect(failed.status).toBe("failed");expect(failed.error).toBeTruthy();
 const model=gateway();expect((await createProjectAssistantRun(db,owner,projectId,{prompt:"客户？",consent:true},"configured",()=>model)).status).toBe("succeeded");
 expect(getProjectAssistantView(db,owner,projectId).runs).toHaveLength(2);
});
it("caps evidence sent to the model and reports documents beyond extraction limits",async()=>{
 knowledge("oversized",projectId,"一般内容。".repeat(110000));const model=gateway();
 const result=await createProjectAssistantRun(db,owner,projectId,{prompt:"内容？",consent:true},"bounded",()=>model);
 expect(result.sources[0].truncated).toBe(true);expect(result.warnings.join(" ")).toContain("500000");expect(model.generateText.mock.calls[0][0].user.length).toBeLessThan(40000);
});
it("rejects unknown projects, blank identities, malformed bodies and missing request keys",async()=>{
 const model=gateway();
 await expect(createProjectAssistantRun(db,owner,"absent",{prompt:"问题",consent:true},"key",()=>model)).rejects.toThrow(/项目不存在/);
 await expect(createProjectAssistantRun(db,{...owner,accountId:""},projectId,{prompt:"问题",consent:true},"key",()=>model)).rejects.toThrow(/身份/);
 await expect(createProjectAssistantRun(db,owner,projectId,{prompt:"问题",consent:true,extra:"x"},"key",()=>model)).rejects.toThrow();
 await expect(createProjectAssistantRun(db,owner,projectId,{prompt:"问题",consent:true},"",()=>model)).rejects.toThrow(/幂等/);
 expect(model.generateText).not.toHaveBeenCalled();
});
