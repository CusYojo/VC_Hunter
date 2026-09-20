import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { WorkspaceActivityRepository } from "@/repositories/workspace-activity";
let db: DatabaseSync;
let repository: WorkspaceActivityRepository;
beforeEach(() => { db=createDatabase(":memory:"); initializeDatabase(db); repository=new WorkspaceActivityRepository(db,["alice","bob","carol"]); });
afterEach(() => { db.close(); vi.useRealTimers(); });
it.each(["task","meeting","trip","approval"])("creates an unassigned %s using only type and title, visible to its author", kind => {
  const saved=repository.create({kind,title:"只填必填项"},"alice",kind);
  expect(saved).toMatchObject({kind,title:"只填必填项",description:"",dueAt:null,location:"",projectId:null,responses:[]});
  expect(repository.list("alice").map(item=>item.id)).toEqual([saved.id]);
  expect(repository.list("bob")).toEqual([]);
  expect(repository.create({kind,title:"只填必填项"},"alice",kind).id).toBe(saved.id);
});
it("edits creator-owned fields atomically with optimistic versions and durable retry keys", () => {
  vi.useFakeTimers({toFake:["Date"]}); vi.setSystemTime(new Date("2026-09-04T01:00:00Z"));
  const saved=repository.create({kind:"task",title:"原事项",participantIds:["bob"]},"alice","original");
  repository.uploadDocument(saved.id,{expectedVersion:1,name:"原件.txt",mimeType:"text/plain",bytes:Buffer.from("原件")},"alice","doc");
  vi.setSystemTime(new Date("2026-09-04T02:00:00Z"));
  const input={kind:"meeting",title:"改为会议",description:"议题说明",participantIds:["carol"],dueAt:null,location:"线上",projectId:null,expectedVersion:2};
  const edited=repository.edit(saved.id,input,"alice","edit-1");
  expect(edited).toMatchObject({kind:"meeting",title:"改为会议",description:"议题说明",dueAt:null,location:"线上",version:3,updatedAt:"2026-09-04T02:00:00.000Z"});
  expect(edited.createdAt).toBe(saved.createdAt); expect(edited.documents).toHaveLength(1);
  expect(edited.responses).toMatchObject([{memberId:"carol",action:"pending"}]);
  expect(repository.list("bob")).toEqual([]); expect(repository.list("carol")[0].title).toBe("改为会议");
  expect(repository.edit(saved.id,input,"alice","edit-1")).toEqual(edited);
  expect(()=>repository.edit(saved.id,{...input,title:"篡改"},"alice","edit-1")).toThrow(/幂等/);
  expect(()=>repository.edit(saved.id,input,"alice","stale")).toThrow(/版本冲突/);
  expect(edited.audit.filter(event=>event.action==="edited")).toHaveLength(1);
});
it("rejects non-creators and invalid members without changing the original", () => {
  const saved=repository.create({kind:"task",title:"原事项",participantIds:["bob"]},"alice","original");
  const input={kind:"task",title:"新标题",expectedVersion:1};
  expect(()=>repository.edit(saved.id,input,"bob","forged")).toThrow(/权限/);
  expect(()=>repository.edit(saved.id,{...input,participantIds:["missing"]},"alice","bad-member")).toThrow(/成员/);
  expect(()=>repository.edit(saved.id,{...input,createdBy:"bob"},"alice","injected")).toThrow();
  expect(repository.list("alice")[0]).toEqual(saved);
});
it("requires renewed responses after an edit and retains the earlier approval in the audit", () => {
  const saved=repository.create({kind:"approval",title:"原审批",participantIds:["bob"]},"alice","original");
  repository.respond(saved.id,{action:"approved",note:"初稿通过",expectedVersion:1},"bob");
  const edited=repository.edit(saved.id,{kind:"approval",title:"修改审批内容",participantIds:["bob"],expectedVersion:2},"alice","edit-approval");
  expect(edited.responses[0].action).toBe("pending");
  expect(edited.audit.some(event=>event.action==="approved"&&event.note==="初稿通过")).toBe(true);
  expect(repository.respond(saved.id,{action:"approved",note:"新稿通过",expectedVersion:3},"bob").responses[0].action).toBe("approved");
});
it("creates and edits one project-document approval with multiple approvers", () => {
  const saved=repository.create({kind:"approval",title:"多方资料审批",participantIds:["bob","carol"]},"alice","multi-approval");
  expect(saved.responses.map(response=>response.memberId).sort()).toEqual(["bob","carol"]);
  const edited=repository.edit(saved.id,{kind:"approval",title:"多方资料审批更新",participantIds:["carol"],expectedVersion:1},"alice","edit-multi-approval");
  expect(edited.responses.map(response=>response.memberId)).toEqual(["carol"]);
  const removed = db.prepare("SELECT read_at FROM member_notifications WHERE recipient_id='bob' AND kind='approval_requested' AND target_url=?").get(`/approvals?activity=${saved.id}`);
  expect(removed?.read_at).toEqual(expect.any(String));
});
it("closes the old approval notification when an edit keeps the person but changes the activity type", () => {
  const saved=repository.create({kind:"approval",title:"改类审批",participantIds:["bob"]},"alice","change-kind");
  repository.edit(saved.id,{kind:"task",title:"改为待办",participantIds:["bob"],expectedVersion:1},"alice","change-kind-edit");
  const notifications=db.prepare("SELECT kind,target_url,read_at FROM member_notifications WHERE recipient_id='bob' ORDER BY created_at,rowid").all();
  expect(notifications).toEqual([
    expect.objectContaining({kind:"approval_requested",target_url:`/approvals?activity=${saved.id}`,read_at:expect.any(String)}),
    expect.objectContaining({kind:"activity_updated",target_url:`/work?activity=${saved.id}`,read_at:null}),
  ]);
});
it("does not reset responses or change edit time when saving unchanged fields", () => {
  const input={kind:"task",title:"没有改变",participantIds:["bob"],dueAt:"2026-09-05T02:00:00.000Z"};
  const saved=repository.create(input,"alice","no-change");
  const accepted=repository.respond(saved.id,{action:"accepted",expectedVersion:1},"bob");
  const result=repository.edit(saved.id,{...input,expectedVersion:2},"alice","same");
  expect(result).toEqual(accepted);
  expect(result.audit.filter(event=>event.action==="edited")).toEqual([]);
});
it("persists optional event end times and validates chronological spans", () => {
  const created = repository.create({ kind:"meeting",title:"跨时段会议",dueAt:"2026-09-04T01:30:00.000Z",endAt:"2026-09-04T04:00:00.000Z",participantIds:["bob"] },"alice","span");
  expect(created.endAt).toBe("2026-09-04T04:00:00.000Z");
  expect(repository.list("bob")[0].endAt).toBe("2026-09-04T04:00:00.000Z");
  expect(() => repository.create({ kind:"meeting",title:"错误时段",dueAt:"2026-09-04T04:00:00.000Z",endAt:"2026-09-04T01:30:00.000Z" },"alice","bad-span")).toThrow();
  expect(() => repository.create({ kind:"meeting",title:"全天冲突",dueAt:null,endAt:"2026-09-04T01:30:00.000Z" },"alice","bad-all-day")).toThrow();
});
