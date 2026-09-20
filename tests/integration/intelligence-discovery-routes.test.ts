import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";

const mocks = vi.hoisted(() => ({ identity: vi.fn(), database: vi.fn() }));
vi.mock("@/security/workspace-session", () => ({ resolveWorkspaceIdentity: mocks.identity }));
vi.mock("@/db/app", () => ({ getAppDatabase: mocks.database }));

import { GET as getItems, POST as createItem } from "@/app/api/v1/discovery/items/route";
import { PATCH as reviewItem } from "@/app/api/v1/discovery/items/[id]/review/route";
import { POST as previewImport } from "@/app/api/v1/discovery/imports/preview/route";
import { POST as commitImport } from "@/app/api/v1/discovery/imports/[id]/commit/route";
import { GET as getPlans, PATCH as patchPlan } from "@/app/api/v1/discovery/plans/route";
import { GET as getTechnologies } from "@/app/api/v1/technologies/route";

const now = "2026-09-14T01:00:00.000Z";
const item = {
  externalId: "manual-route-1", entityType: "company", candidateKind: "new_entity", name: "路由测试公司", track: "AI", subtrack: "行业智能", city: "北京",
  signalType: "funding", eventDate: "2026-09-13", channel: "manual_codex", discoveryReason: "公开新闻披露完成新一轮融资。",
  investmentSummary: "该公司围绕行业智能模型形成产品矩阵，并在垂直场景获得客户验证。投资亮点是团队拥有持续交付能力且融资信号新鲜；关键待核问题是合同质量、推理成本与本轮估值，需要在后续尽调中结合客户访谈和财务材料核实。",
  investmentHighlights: ["垂直场景已有客户验证"], openQuestions: ["合同质量与估值是否匹配？"],
  scores: { technology: 4, team: 4, commercial: 3, signal: 5, evidence: 4 },
  evidence: [{ ref: "news", title: "融资公告", url: "https://route.example.com/funding", publishedAt: "2026-09-13T01:00:00.000Z", observedAt: now, excerpt: "公司宣布完成融资并披露产品进展。", authority: "B", accessClass: "public", collectionMethod: "manual_upload", allowExternalModel: true }],
  assertions: [{ field: "fundingHistory", label: "融资历史", valueStatus: "known", epistemicType: "fact", value: "完成融资", confidence: 0.9, evidenceRefs: ["news"] }],
  relationships: [], contacts: [], company: { officialWebsite: "https://route.example.com", researchLocations: ["北京"], products: ["行业智能模型"], coreTechnologies: ["模型工程"], competitors: [] },
};

function identity(role: string) {
  mocks.identity.mockResolvedValue({ user: { id: `${role}-member`, name: role, role, capabilities: [] }, accountId: `${role}-account`, tenantId: "org", roles: [role] });
}
function jsonRequest(url: string, method: string, body: unknown, key = "request-1") {
  return new Request(url, { method, headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body) });
}

describe("intelligence discovery API", () => {
  let database: DatabaseSync;
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BETTER_AUTH_URL", "http://localhost");
    database = createDatabase(":memory:"); initializeDatabase(database); mocks.database.mockReturnValue(database); identity("org_admin");
  });
  afterEach(() => { database.close(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it("lets researchers create candidates, keeps them pending, and lets investment managers review them", async () => {
    identity("researcher");
    const created = await createItem(jsonRequest("http://localhost/api/v1/discovery/items", "POST", item));
    expect(created.status).toBe(201);
    const candidate = (await created.json()).data;
    expect(candidate).toMatchObject({ name: "路由测试公司", status: "pending_review", completeness: "L1" });
    expect(database.prepare("SELECT count(*) AS count FROM projects").get()).toEqual({ count: 0 });
    const repeated = await createItem(jsonRequest("http://localhost/api/v1/discovery/items", "POST", item));
    expect((await repeated.json()).data.id).toBe(candidate.id);
    expect(database.prepare("SELECT count(*) AS count FROM intelligence_candidates").get()).toEqual({ count: 1 });
    const conflicting = await createItem(jsonRequest("http://localhost/api/v1/discovery/items", "POST", { ...item, name: "另一个项目" }));
    expect(conflicting.status).toBe(409);

    identity("investment_manager");
    const reviewed = await reviewItem(jsonRequest(`http://localhost/api/v1/discovery/items/${candidate.id}/review`, "PATCH", { decision: "promote", expectedVersion: 1, reason: "来源可核验，进入正式跟进。" }, "review-1"), { params: Promise.resolve({ id: candidate.id }) });
    expect(reviewed.status).toBe(200);
    expect((await reviewed.json()).data).toMatchObject({ status: "promoted", version: 2 });
    expect(database.prepare("SELECT count(*) AS count FROM projects").get()).toEqual({ count: 1 });
  });

  it("supports filtered reads and rejects identity injection and unsafe URLs", async () => {
    identity("researcher");
    await createItem(jsonRequest("http://localhost/api/v1/discovery/items", "POST", item));
    const list = await getItems(new Request("http://localhost/api/v1/discovery/items?entityType=company&channel=manual_codex&city=%E5%8C%97%E4%BA%AC"));
    expect(list.status).toBe(200); expect((await list.json()).data.total).toBe(1);
    expect((await getItems(new Request("http://localhost/api/v1/discovery/items?tenantId=other"))).status).toBe(400);
    const unsafe = { ...item, externalId: "unsafe", evidence: [{ ...item.evidence[0], url: "https://169.254.169.254/latest/meta-data" }] };
    expect((await createItem(jsonRequest("http://localhost/api/v1/discovery/items", "POST", unsafe, "unsafe"))).status).toBe(400);
  });

  it("limits import preview/commit to administrators and preserves the two-step confirmation", async () => {
    const bundle = { schemaVersion: "1.0", batch: { id: "route-batch", createdAt: now, createdBy: "Codex", accessClass: "public" }, items: [item] };
    identity("researcher");
    expect((await previewImport(jsonRequest("http://localhost/api/v1/discovery/imports/preview", "POST", bundle, "preview"))).status).toBe(403);
    identity("org_admin");
    const preview = await previewImport(jsonRequest("http://localhost/api/v1/discovery/imports/preview", "POST", bundle, "preview"));
    expect(preview.status).toBe(200);
    const previewData = (await preview.json()).data;
    expect(database.prepare("SELECT count(*) AS count FROM intelligence_candidates").get()).toEqual({ count: 0 });
    const committed = await commitImport(jsonRequest(`http://localhost/api/v1/discovery/imports/${previewData.importId}/commit`, "POST", { expectedVersion: 1 }, "commit"), { params: Promise.resolve({ id: previewData.importId }) });
    expect(committed.status).toBe(201);
    expect(database.prepare("SELECT status FROM intelligence_candidates").get()).toEqual({ status: "pending_review" });
  });

  it("uses a scoped demo identity for local no-auth imports", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VC_HUNTER_AUTH_ENABLED", "false");
    const bundle = { schemaVersion: "1.0", batch: { id: "local-demo-batch", createdAt: now, createdBy: "Codex", accessClass: "public" }, items: [item] };
    const response = await previewImport(jsonRequest("http://localhost/api/v1/discovery/imports/preview", "POST", bundle, "local-preview"));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ total: 1, valid: 1 });
  });

  it("exposes four configurable public plans, keeps licensed adapters gated, and only administrators can update them", async () => {
    identity("researcher");
    const plans = await getPlans(new Request("http://localhost/api/v1/discovery/plans"));
    expect((await plans.json()).data.items).toHaveLength(4);
    expect((await patchPlan(jsonRequest("http://localhost/api/v1/discovery/plans", "PATCH", { id: "registry", enabled: false, expectedVersion: 1 }, "plan"))).status).toBe(403);
    identity("org_admin");
    const updated = await patchPlan(jsonRequest("http://localhost/api/v1/discovery/plans", "PATCH", { id: "registry", enabled: false, expectedVersion: 1 }, "plan"));
    expect(updated.status).toBe(200);
    expect((await updated.json()).data).toMatchObject({ id: "registry", enabled: false, connectorReady: true, version: 2 });
    database.prepare(`INSERT INTO discovery_plans_v2(id,name,channel,query_family,tracks_json,subtracks_json,cities_json,preferred_domains_json,date_window_days,connector_type,enabled,schedule_json,next_run_at,version,created_at,updated_at)
      SELECT 'registry-licensed','工商付费适配器',channel,query_family,tracks_json,subtracks_json,cities_json,preferred_domains_json,date_window_days,'licensed_api',0,schedule_json,next_run_at,1,created_at,updated_at FROM discovery_plans_v2 WHERE id='registry'`).run();
    const gated = await patchPlan(jsonRequest("http://localhost/api/v1/discovery/plans", "PATCH", { id: "registry-licensed", enabled: true, expectedVersion: 1 }, "licensed-plan"));
    expect(gated.status).toBe(400);
    expect((await gated.json()).error).toMatchObject({ code: "CONNECTOR_NOT_READY" });
    database.prepare(`INSERT INTO sources(id,name,source_type,authority,access_mode,robots_status,license_notes,policy_status,independent_group,last_checked_at,channel,connector_type,terms_review_status,credential_ref)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run("licensed-registry", "正式工商数据 API", "company_registry", "A", "api", "not_applicable", "已取得正式授权", "approved", "licensed-registry", now, "registry", "licensed_api", "reviewed", "secret://vc-hunter/registry-api");
    const stillDisabled = await patchPlan(jsonRequest("http://localhost/api/v1/discovery/plans", "PATCH", { id: "registry-licensed", enabled: true, expectedVersion: 1 }, "plan-authorized"));
    expect(stillDisabled.status).toBe(400);
    expect((await stillDisabled.json()).error).toMatchObject({ code: "CONNECTOR_NOT_READY" });
  });

  it("serves the formal technology library read-only", async () => {
    database.prepare(`INSERT INTO technologies(id,name,normalized_name,track,definition,maturity,key_metrics_json,papers_json,patents_json,alternatives_json,competitors_json,created_at,updated_at)
      VALUES('tech-route','光互连','光互连','半导体','芯片间高速光通信。','engineering_validation','[]','[]','[]','[]','[]',?,?)`).run(now, now);
    const response = await getTechnologies(new Request("http://localhost/api/v1/technologies?query=%E5%85%89%E4%BA%92%E8%BF%9E"));
    expect(response.status).toBe(200); expect((await response.json()).data.items[0]).toMatchObject({ id: "tech-route", name: "光互连" });
  });
});
