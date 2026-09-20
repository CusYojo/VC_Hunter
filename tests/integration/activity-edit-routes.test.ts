import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
const mocks=vi.hoisted(()=>({identity:vi.fn(),database:vi.fn()}));
vi.mock("@/security/workspace-session",()=>({resolveWorkspaceIdentity:mocks.identity}));
vi.mock("@/db/app",()=>({getAppDatabase:mocks.database}));
vi.mock("@/workbench/team",async()=>{
  const {identityScope}=await import("@/security/identity-scope");
  return {getCurrentUser:()=>({id:identityScope.getStore()?.user.id}),loadTeamMembers:()=>["alice","bob"].map(id=>({id}))};
});
import { POST } from "@/app/api/v1/activity/route";
import { PATCH } from "@/app/api/v1/activity/[id]/edit/route";
let db:DatabaseSync;
function identity(id="alice"){mocks.identity.mockResolvedValue({user:{id},accountId:`account-${id}`,tenantId:"org",roles:["investment_manager"]});}
function request(path:string,payload:unknown,method="PATCH",key="edit",origin="http://localhost"){
  return new Request(`http://localhost${path}`,{method,headers:{origin,"content-type":"application/json","idempotency-key":key},body:JSON.stringify(payload)});
}
beforeEach(()=>{vi.stubEnv("NODE_ENV","production");vi.stubEnv("BETTER_AUTH_URL","http://localhost");db=createDatabase(":memory:");initializeDatabase(db);mocks.database.mockReturnValue(db);identity();});
afterEach(()=>{db.close();vi.unstubAllEnvs();vi.clearAllMocks();});
it("supports title-only creation then author editing, and rejects unrelated actors and cross-site writes",async()=>{
  const created=await POST(request("/api/v1/activity",{kind:"approval",title:"待补充审批"},"POST","create"));
  expect(created.status).toBe(200);const original=(await created.json()).data;
  expect(original.dueAt).toBeNull(); expect(original.responses).toEqual([]);
  const path=`/api/v1/activity/${original.id}/edit`;const params={params:Promise.resolve({id:original.id})};
  const body={kind:"approval",title:"资料审批",participantIds:["bob"],expectedVersion:1};
  mocks.identity.mockResolvedValue(null);expect((await PATCH(request(path,body),params)).status).toBe(401);
  identity("bob");expect((await PATCH(request(path,body),params)).status).toBe(403);
  identity();expect((await PATCH(request(path,body,"PATCH","edit","https://evil.test"),params)).status).toBe(403);
  expect((await PATCH(request(path,{...body,createdBy:"bob"}),params)).status).toBe(400);
  expect((await PATCH(request(path,body,"PATCH",""),params)).status).toBe(400);
  const changed=await PATCH(request(path,body),params);expect(changed.status).toBe(200);
  expect((await changed.json()).data).toMatchObject({title:"资料审批",version:2,responses:[{memberId:"bob",action:"pending"}]});
  expect((await PATCH(request(path,body),params)).status).toBe(200);
  expect((await PATCH(request(path,body,"PATCH","stale"),params)).status).toBe(409);
});
it("rejects malformed and oversized editing bodies without updating a record",async()=>{
  const made=await POST(request("/api/v1/activity",{kind:"task",title:"测试"},"POST","create"));
  const {id}= (await made.json()).data;const path=`/api/v1/activity/${id}/edit`;const params={params:Promise.resolve({id})};
  const malformed=new Request(`http://localhost${path}`,{method:"PATCH",headers:{origin:"http://localhost","idempotency-key":"malformed","content-type":"application/json"},body:"{"});
  expect((await PATCH(malformed,params)).status).toBe(400);
  expect((await PATCH(request(path,{kind:"task",title:"测试",description:"x".repeat(70000),expectedVersion:1}),params)).status).toBe(413);
  expect(db.prepare("SELECT version FROM workspace_activity WHERE id=?").get(id)?.version).toBe(1);
});
