import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import {
  IntelligenceDiscoveryRepository,
  IntelligenceDiscoveryError,
} from "@/intelligence/repository";
import { SqliteProjectRepository } from "@/repositories/projects";

const source = {
  ref: "official",
  title: "企业官网公告",
  url: "https://nova.example.com/news/launch",
  publishedAt: "2026-09-12T02:00:00.000Z",
  observedAt: "2026-09-13T01:00:00.000Z",
  excerpt: "诺瓦材料发布新型高温复合材料并启动客户验证。",
  authority: "A" as const,
  accessClass: "public" as const,
  collectionMethod: "codex" as const,
  allowExternalModel: true,
};

const company = {
  externalId: "company-nova",
  entityType: "company" as const,
  candidateKind: "new_entity" as const,
  name: "诺瓦材料",
  track: "新材料" as const,
  subtrack: "高温复合材料",
  city: "苏州",
  signalType: "product_launch",
  eventDate: "2026-09-12",
  channel: "venture_tech" as const,
  discoveryReason: "官网披露新品和客户验证。",
  investmentSummary: "诺瓦材料面向商业航天热防护场景推出新型高温复合材料，并启动首批客户验证。投资亮点是材料配方与工艺协同、下游验证节奏明确；关键待核问题是量产良率、订单转化和知识产权边界，需要结合客户及专利材料继续核实。",
  investmentHighlights: ["配方与工艺协同形成潜在壁垒"],
  openQuestions: ["量产良率和客户订单能否交叉验证？"],
  scores: { technology: 5, team: 3, commercial: 4, signal: 4, evidence: 4 },
  evidence: [source],
  assertions: [
    { field: "products", label: "产品", valueStatus: "known" as const, epistemicType: "fact" as const, value: ["高温复合材料"], confidence: 0.9, evidenceRefs: ["official"] },
    { field: "coreTechnology", label: "核心技术", valueStatus: "known" as const, epistemicType: "fact" as const, value: "耐高温配方与成型工艺", confidence: 0.85, evidenceRefs: ["official"] },
  ],
  relationships: [{ entityType: "person" as const, name: "林博士", relation: "创始人兼首席科学家", confidence: 0.8, evidenceRefs: ["official"] }],
  contacts: [{ type: "website_contact" as const, value: "https://nova.example.com/contact", sourceRef: "official", verifiedAt: source.observedAt }],
  company: { officialWebsite: "https://nova.example.com", unifiedCreditCode: "91320500TESTNOVA", registeredAddress: "苏州市工业园区", researchLocations: ["苏州"], businessScope: "先进复合材料研发", products: ["高温复合材料"], coreTechnologies: ["耐高温配方与成型工艺"], competitors: [], fundingHistory: [{ round: "angel" as const, announcedAt: "2026-09-12", amount: 100_000_000, currency: "CNY" as const, disclosureType: "exact" as const, valuation: 800_000_000, investors: ["星河资本"], leadInvestors: ["星河资本"], sourceRefs: ["official"] }], mergersAndAcquisitions: [{ acquirerName: "远星产业集团", announcementDate: "2026-09-11", transactionType: "strategic_investment" as const, transactionValue: 20_000_000, currency: "CNY" as const, transactionStage: "closed" as const, strategicRationale: "共同验证商业航天热防护材料。", sourceRefs: ["official"] }] },
};

const bundle = { schemaVersion: "1.0", batch: { id: "codex-batch-1", createdAt: "2026-09-13T01:00:00.000Z", createdBy: "Codex", accessClass: "public" as const }, items: [company] };

describe("unified intelligence discovery repository", () => {
  let database: DatabaseSync;
  let repository: IntelligenceDiscoveryRepository;

  beforeEach(() => {
    database = createDatabase(":memory:");
    initializeDatabase(database);
    repository = new IntelligenceDiscoveryRepository(database);
  });

  afterEach(() => database.close());

  it("returns plain contact records for the discovery client boundary", () => {
    const candidate = repository.create(company, { actorId: "admin", idempotencyKey: "plain-contacts", now: source.observedAt });
    const contact = repository.get(candidate.id)?.contacts?.[0];
    expect(contact).toMatchObject({ type: "website_contact", value: "https://nova.example.com/contact" });
    expect(Object.getPrototypeOf(contact)).toBe(Object.prototype);
    expect(repository.list({ query: "诺瓦", city: "苏州", dateFrom: "2026-09-12", dateTo: "2026-09-12", limit: 1, offset: 0 }).items.map((item) => item.id)).toEqual([candidate.id]);
  });

  it("adds the forward-only discovery schema and backfills legacy candidates without changing legacy ids", () => {
    seedDemoData(database);
    database.prepare("INSERT INTO web_search_leads(id,url,title,highlights_json,first_seen_at,last_seen_at,status) VALUES (?,?,?,?,?,?,?)")
      .run("legacy-lead", "https://example.com/legacy", "旧线索", "[]", source.observedAt, source.observedAt, "discovered");
    database.prepare(`INSERT INTO project_candidates(id,lead_id,company_name,track,investor_names_json,signal_type,summary,confidence,status,model,prompt_version,created_at,updated_at,review_version,promoted_project_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run("legacy-candidate", "legacy-lead", "旧项目", "AI", "[]", "funding", "旧项目融资线索", 0.8, "promoted", "legacy", "v1", source.observedAt, source.observedAt, 3, "project-qiongxin");

    expect(repository.get("legacy-candidate")).toMatchObject({ id: "legacy-candidate", legacyProjectCandidateId: "legacy-candidate" });
    const result = repository.backfillLegacyCandidates(source.observedAt);
    expect(result).toEqual({ inserted: 0, skipped: 1 });
    expect(repository.get("legacy-candidate")).toMatchObject({ id: "legacy-candidate", legacyProjectCandidateId: "legacy-candidate", version: 3, entityType: "company", status: "promoted", promotedEntityId: "company-qiongxin" });
    expect(database.prepare("SELECT id,status,review_version FROM project_candidates WHERE id='legacy-candidate'").get()).toEqual({ id: "legacy-candidate", status: "promoted", review_version: 3 });
    expect(database.prepare("SELECT url FROM intelligence_candidate_sources WHERE candidate_id='legacy-candidate'").get()).toEqual({ url: "https://example.com/legacy" });
    expect(repository.backfillLegacyCandidates(source.observedAt)).toEqual({ inserted: 0, skipped: 1 });
  });

  it("previews and atomically commits a Codex bundle with duplicate and entity-match suggestions", () => {
    database.prepare("INSERT INTO companies(id,legal_name,aliases_json,official_domain,region_scope,unified_credit_code) VALUES (?,?,?,?,?,?)")
      .run("existing-company", "诺瓦材料科技有限公司", "[]", "nova.example.com", "苏州", "91320500TESTNOVA");

    const preview = repository.previewImport(bundle, { tenantId: "org", actorId: "admin", idempotencyKey: "preview-1", rawBytes: Buffer.byteLength(JSON.stringify(bundle)), now: source.observedAt });
    expect(preview).toMatchObject({ total: 1, valid: 1, errors: [], duplicates: [] });
    expect(preview.items[0].scores.team).toBe(1);
    expect(preview.items[0].matches[0]).toMatchObject({ entityType: "company", entityId: "existing-company", confidence: 1, reason: "统一社会信用代码一致" });

    const committed = repository.commitImport(preview.importId, { tenantId: "org", actorId: "admin", expectedVersion: 1, now: source.observedAt });
    expect(committed).toMatchObject({ inserted: 1, skipped: 0 });
    expect(repository.list({ status: "pending_review" }).items[0]).toMatchObject({ name: "诺瓦材料", candidateKind: "entity_update", matchedEntityId: "existing-company", priority: "A", completeness: "L1" });
    expect(repository.commitImport(preview.importId, { tenantId: "org", actorId: "admin", expectedVersion: 1, now: source.observedAt })).toEqual(committed);
    const pending = repository.list({ status: "pending_review" }).items[0];
    expect(repository.review(pending.id, { decision: "merge", expectedVersion: 1, reason: "确认是已有公司，追加本次产品信号。" }, { actorId: "manager", idempotencyKey: "merge-existing", now: source.observedAt })).toMatchObject({ status: "merged", promotedEntityId: "existing-company" });
    expect(database.prepare("SELECT entity_id,signal_type FROM entity_intelligence_events").get()).toEqual({ entity_id: "existing-company", signal_type: "product_launch" });
    expect(database.prepare("SELECT count(*) AS count FROM companies").get()).toEqual({ count: 1 });
  });

  it("expires uncommitted previews and does not retain invalid raw records", () => {
    const mixed = { ...bundle, batch: { ...bundle.batch, id: "expiring" }, items: [company, { privatePhone: "13800000000" }] };
    const preview = repository.previewImport(mixed, { tenantId: "org", actorId: "admin", idempotencyKey: "expiring", rawBytes: Buffer.byteLength(JSON.stringify(mixed)), now: source.observedAt });
    const stored = database.prepare("SELECT original_json,expires_at FROM discovery_import_batches WHERE id=?").get(preview.importId) as { original_json: string; expires_at: string };
    expect(stored.original_json).not.toContain("13800000000");
    expect(Date.parse(stored.expires_at)).toBeGreaterThan(Date.parse(source.observedAt));
    database.prepare("UPDATE discovery_import_batches SET expires_at='2026-09-12T00:00:00.000Z' WHERE id=?").run(preview.importId);
    expect(() => repository.commitImport(preview.importId, { tenantId: "org", actorId: "admin", expectedVersion: 1, now: source.observedAt })).toThrowError(IntelligenceDiscoveryError);
    expect(database.prepare("SELECT 1 FROM discovery_import_batches WHERE id=?").get(preview.importId)).toBeUndefined();
  });

  it("rejects oversize imports and reports unsafe records without hiding valid records", () => {
    expect(() => repository.previewImport(bundle, { tenantId: "org", actorId: "admin", idempotencyKey: "large", rawBytes: 16 * 1024 * 1024 + 1, now: source.observedAt })).toThrowError(IntelligenceDiscoveryError);
    const mixed = { ...bundle, batch: { ...bundle.batch, id: "mixed" }, items: [company, { ...company, externalId: "unsafe", evidence: [{ ...source, url: "https://127.0.0.1/private" }] }] };
    const preview = repository.previewImport(mixed, { tenantId: "org", actorId: "admin", idempotencyKey: "mixed", rawBytes: Buffer.byteLength(JSON.stringify(mixed)), now: source.observedAt });
    expect(preview).toMatchObject({ total: 2, valid: 1, errors: [{ index: 1 }] });
    expect((database.prepare("SELECT original_json FROM discovery_import_batches WHERE id=?").get(preview.importId) as { original_json: string }).original_json).not.toContain("127.0.0.1");
    expect(repository.list({}).total).toBe(0);
    expect(repository.commitImport(preview.importId, { tenantId: "org", actorId: "admin", expectedVersion: 1, now: source.observedAt })).toMatchObject({ inserted: 1, skipped: 0 });
    expect(repository.list({}).items.map((item) => item.externalId)).toEqual(["company-nova"]);
  });

  it("requires human review, promotes a company with traceable evidence, and records later signals as updates", () => {
    const preview = repository.previewImport(bundle, { tenantId: "org", actorId: "admin", idempotencyKey: "review", rawBytes: Buffer.byteLength(JSON.stringify(bundle)), now: source.observedAt });
    repository.commitImport(preview.importId, { tenantId: "org", actorId: "admin", expectedVersion: 1, now: source.observedAt });
    const item = repository.list({}).items[0];
    expect(database.prepare("SELECT count(*) AS count FROM projects").get()).toEqual({ count: 0 });

    const promoted = repository.review(item.id, { decision: "promote", expectedVersion: 1, reason: "信息达到 L1，进入正式跟进。" }, { actorId: "manager", idempotencyKey: "review-company", now: source.observedAt });
    expect(promoted).toMatchObject({ status: "promoted", entityType: "company" });
    expect(database.prepare("SELECT count(*) AS count FROM projects").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT count(*) AS count FROM assertion_evidence").get()).toEqual({ count: 2 });
    expect(database.prepare("SELECT unified_credit_code FROM companies").get()).toEqual({ unified_credit_code: null });
    expect(database.prepare("SELECT registered_address,business_scope FROM company_profiles").get()).toEqual({ registered_address: null, business_scope: null });
    expect(database.prepare("SELECT count(*) AS count FROM entity_assertions WHERE value_status<>'unknown' AND evidence_ids_json='[]'").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT public_basis,evidence_id,reviewed_by FROM entity_public_contacts").get()).toEqual({ public_basis: "public_work_contact", evidence_id: expect.stringContaining("intelligence-evidence-"), reviewed_by: "manager" });
    expect(database.prepare("SELECT round,amount,valuation,investors_json,source_refs_json FROM investment_events").get()).toEqual({ round: "angel", amount: 100_000_000, valuation: 800_000_000, investors_json: '["星河资本"]', source_refs_json: expect.stringContaining("intelligence-evidence-") });
    expect(database.prepare("SELECT acquirer_name,transaction_value,transaction_stage,source_refs_json FROM ma_events").get()).toEqual({ acquirer_name: "远星产业集团", transaction_value: 20_000_000, transaction_stage: "closed", source_refs_json: expect.stringContaining("intelligence-evidence-") });
    const projectId = (database.prepare("SELECT id FROM projects").get() as { id: string }).id;
    expect(new SqliteProjectRepository(database).findById(projectId)?.companyIntelligence?.team).toContainEqual(expect.objectContaining({ name: "林博士", role: "创始人兼首席科学家" }));

    const updateSource = { ...source, ref: "update", url: "https://nova.example.com/news/customer-validation", excerpt: "诺瓦材料披露新增客户验证进展。" };
    const updateBundle = { ...bundle, batch: { ...bundle.batch, id: "codex-batch-2" }, items: [{ ...company, externalId: "company-nova-update", candidateKind: "entity_update" as const, discoveryReason: "官网披露新增客户验证进展。", evidence: [updateSource], assertions: company.assertions.map((assertion) => ({ ...assertion, evidenceRefs: ["update"] })), relationships: company.relationships.map((relationship) => ({ ...relationship, evidenceRefs: ["update"] })), contacts: [], company: { ...company.company, fundingHistory: [], mergersAndAcquisitions: [] } }] };
    const second = repository.previewImport(updateBundle, { tenantId: "org", actorId: "admin", idempotencyKey: "update", rawBytes: Buffer.byteLength(JSON.stringify(updateBundle)), now: "2026-09-14T01:00:00.000Z" });
    repository.commitImport(second.importId, { tenantId: "org", actorId: "admin", expectedVersion: 1, now: source.observedAt });
    const update = repository.list({ status: "pending_review" }).items[0];
    repository.review(update.id, { decision: "promote", expectedVersion: 1, reason: "确认新增产品事件。" }, { actorId: "manager", idempotencyKey: "review-update", now: source.observedAt });
    expect(database.prepare("SELECT count(*) AS count FROM companies").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT count(*) AS count FROM projects").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT count(*) AS count FROM events").get()).toEqual({ count: 2 });
  });

  it("merges partial transaction updates and never moves the latest project signal backwards", () => {
    const created = repository.create(company, { actorId: "researcher", idempotencyKey: "transaction-base", now: source.observedAt });
    repository.review(created.id, { decision: "promote", expectedVersion: 1, reason: "确认首次融资事实。" }, { actorId: "manager", idempotencyKey: "transaction-base-review", now: source.observedAt });
    const projectBefore = database.prepare("SELECT id,latest_event_at,executive_summary FROM projects").get() as { id: string; latest_event_at: string; executive_summary: string };
    const partialSource = { ...source, ref: "follow-up", url: "https://nova.example.com/news/follow-up", excerpt: "补充公告确认融资轮次，但未再次披露金额。" };
    const partial = {
      ...company,
      externalId: "company-nova-partial",
      candidateKind: "entity_update" as const,
      eventDate: "2026-09-10",
      investmentSummary: "较早线索摘要不应覆盖更新日期更晚的项目摘要。",
      evidence: [partialSource],
      assertions: company.assertions.map((assertion) => ({ ...assertion, evidenceRefs: ["follow-up"] })),
      relationships: [], contacts: [],
      company: { ...company.company, fundingHistory: [{ round: "angel" as const, announcedAt: "2026-09-12", disclosureType: "undisclosed" as const, investors: [], leadInvestors: [], sourceRefs: ["follow-up"] }], mergersAndAcquisitions: [{ acquirerName: "远星产业集团", announcementDate: "2026-09-11", transactionType: "strategic_investment" as const, transactionStage: "closed" as const, sourceRefs: ["follow-up"] }] },
    };
    const update = repository.create(partial, { actorId: "researcher", idempotencyKey: "transaction-partial", now: "2026-09-14T01:00:00.000Z" });
    repository.review(update.id, { decision: "merge", expectedVersion: 1, reason: "确认补充来源。" }, { actorId: "manager", idempotencyKey: "transaction-partial-review", now: "2026-09-14T01:00:00.000Z" });

    expect(database.prepare("SELECT amount,valuation,investors_json,source_refs_json FROM investment_events").get()).toEqual({
      amount: 100_000_000, valuation: 800_000_000, investors_json: '["星河资本"]', source_refs_json: expect.stringMatching(/intelligence-evidence-.*intelligence-evidence-/),
    });
    expect(database.prepare("SELECT transaction_value,strategic_rationale,source_refs_json FROM ma_events").get()).toEqual({
      transaction_value: 20_000_000, strategic_rationale: "共同验证商业航天热防护材料。", source_refs_json: expect.stringMatching(/intelligence-evidence-.*intelligence-evidence-/),
    });
    expect(database.prepare("SELECT latest_event_at,executive_summary FROM projects WHERE id=?").get(projectBefore.id)).toEqual({ latest_event_at: projectBefore.latest_event_at, executive_summary: projectBefore.executive_summary });
  });

  it("promotes person and technology candidates into their own formal libraries", () => {
    const person = { ...company, externalId: "person-1", entityType: "person" as const, name: "张新", track: "AI" as const, company: undefined, contacts: [], assertions: [
      { field: "organization", label: "当前机构", valueStatus: "known" as const, epistemicType: "fact" as const, value: "未来智能实验室", confidence: 0.9, evidenceRefs: ["official"] },
      { field: "education", label: "教育背景", valueStatus: "known" as const, epistemicType: "fact" as const, value: ["清华大学博士"], confidence: 0.9, evidenceRefs: ["official"] },
      { field: "technicalBackground", label: "技术背景", valueStatus: "known" as const, epistemicType: "fact" as const, value: "多模态大模型", confidence: 0.9, evidenceRefs: ["official"] },
    ], person: { organization: "未来智能实验室", title: "教授", education: ["清华大学博士"], employment: ["未来智能实验室教授"], technicalBackground: "多模态大模型", publications: ["Paper A"], patents: [], homepage: "https://people.example.com/zhang" } };
    const technology = { ...company, externalId: "tech-1", entityType: "technology" as const, name: "片上光互连", company: undefined, contacts: [], assertions: [
      { field: "definition", label: "技术定义", valueStatus: "known" as const, epistemicType: "fact" as const, value: "利用硅光器件完成芯片间高速互连。", confidence: 0.9, evidenceRefs: ["official"] },
      { field: "maturity", label: "成熟度", valueStatus: "estimated" as const, epistemicType: "inference" as const, value: "engineering_validation", confidence: 0.7, evidenceRefs: ["official"] },
      { field: "keyMetrics", label: "关键指标", valueStatus: "known" as const, epistemicType: "fact" as const, value: ["带宽密度"], confidence: 0.8, evidenceRefs: ["official"] },
    ], technology: { normalizedName: "片上光互连", definition: "利用硅光器件完成芯片间高速互连。", maturity: "engineering_validation", keyMetrics: ["带宽密度"], papers: ["doi:10.1000/xyz"], patents: [], alternatives: ["电互连"], competitors: [] } };
    for (const [suffix, item] of [["person", person], ["technology", technology]] as const) {
      const nextBundle = { ...bundle, batch: { ...bundle.batch, id: `batch-${suffix}` }, items: [item] };
      const preview = repository.previewImport(nextBundle, { tenantId: "org", actorId: "admin", idempotencyKey: `preview-${suffix}`, rawBytes: Buffer.byteLength(JSON.stringify(nextBundle)), now: source.observedAt });
      repository.commitImport(preview.importId, { tenantId: "org", actorId: "admin", expectedVersion: 1, now: source.observedAt });
      const pending = repository.list({ entityType: item.entityType, status: "pending_review" }).items[0];
      repository.review(pending.id, { decision: "promote", expectedVersion: 1, reason: "完成信息核验。" }, { actorId: "manager", idempotencyKey: `review-${suffix}`, now: source.observedAt });
    }
    expect(repository.listTechnologies({ query: "光互连" }).items[0]).toMatchObject({ name: "片上光互连", maturity: "engineering_validation" });
    expect(database.prepare("SELECT name,current_organization FROM people").get()).toEqual({ name: "张新", current_organization: "未来智能实验室" });
  });

  it("keeps restricted evidence isolated from a public source on the same domain", () => {
    const publicPreview = repository.previewImport(bundle, { tenantId: "org", actorId: "admin", idempotencyKey: "public-preview", rawBytes: Buffer.byteLength(JSON.stringify(bundle)), now: source.observedAt });
    repository.commitImport(publicPreview.importId, { tenantId: "org", actorId: "admin", expectedVersion: 1, now: source.observedAt });
    const first = repository.list({ status: "pending_review" }).items[0];
    repository.review(first.id, { decision: "promote", expectedVersion: 1, reason: "确认公开来源。" }, { actorId: "manager", idempotencyKey: "public-review", now: source.observedAt });

    const restrictedItem = { ...company, externalId: "company-nova-licensed", candidateKind: "entity_update" as const, evidence: [{ ...source, ref: "licensed", url: "https://nova.example.com/licensed/update", accessClass: "licensed_internal" as const, collectionMethod: "api" as const, allowExternalModel: false }], assertions: company.assertions.map((assertion) => ({ ...assertion, evidenceRefs: ["licensed"] })), relationships: company.relationships.map((relationship) => ({ ...relationship, evidenceRefs: ["licensed"] })), contacts: [], company: { ...company.company, fundingHistory: [], mergersAndAcquisitions: [] } };
    const restrictedBundle = { ...bundle, batch: { ...bundle.batch, id: "licensed-batch", accessClass: "licensed_internal" as const }, items: [restrictedItem] };
    const restrictedPreview = repository.previewImport(restrictedBundle, { tenantId: "org", actorId: "admin", idempotencyKey: "licensed-preview", rawBytes: Buffer.byteLength(JSON.stringify(restrictedBundle)), now: source.observedAt });
    repository.commitImport(restrictedPreview.importId, { tenantId: "org", actorId: "admin", expectedVersion: 1, now: source.observedAt });
    const second = repository.list({ status: "pending_review" }).items[0];
    repository.review(second.id, { decision: "merge", expectedVersion: 1, reason: "确认授权来源更新。" }, { actorId: "manager", idempotencyKey: "licensed-review", now: source.observedAt });

    expect(database.prepare("SELECT access_class,allow_external_model FROM sources WHERE name='nova.example.com' ORDER BY access_class").all()).toEqual([
      { access_class: "licensed_internal", allow_external_model: 0 },
      { access_class: "public", allow_external_model: 0 },
    ]);
    expect(database.prepare("SELECT policy_status,terms_review_status FROM sources WHERE access_class='public' AND name='nova.example.com'").get()).toEqual({ policy_status: "manual_only", terms_review_status: "pending" });
  });

  it("scopes review idempotency keys to the candidate", () => {
    const first = repository.create(company, { actorId: "researcher", idempotencyKey: "create-first", now: source.observedAt });
    const secondInput = { ...company, externalId: "company-orbit", name: "轨道材料", company: { ...company.company, legalName: "轨道材料科技有限公司", unifiedCreditCode: "91320500TESTORBIT", officialWebsite: "https://orbit.example.com" } };
    const second = repository.create(secondInput, { actorId: "researcher", idempotencyKey: "create-second", now: source.observedAt });
    const decision = { decision: "promote" as const, expectedVersion: 1, reason: "完成来源核验。" };
    repository.review(first.id, decision, { actorId: "manager", idempotencyKey: "shared-review-key", now: source.observedAt });
    expect(() => repository.review(second.id, decision, { actorId: "manager", idempotencyKey: "shared-review-key", now: source.observedAt })).toThrowError(IntelligenceDiscoveryError);
    expect(repository.get(second.id)).toMatchObject({ status: "pending_review", version: 1 });
  });

  it("deduplicates the same candidate fact even when its external id or observation time changes", () => {
    const first = repository.create(company, { actorId: "researcher", idempotencyKey: "fact-first", now: source.observedAt });
    const repeated = repository.create({ ...company, externalId: "different-export-id", evidence: [{ ...source, observedAt: "2026-09-14T01:00:00.000Z" }] }, { actorId: "researcher", idempotencyKey: "fact-second", now: "2026-09-14T01:00:00.000Z" });
    expect(repeated.id).toBe(first.id);
    expect(repository.list({}).total).toBe(1);
  });

  it("deduplicates a reworded report of the same entity signal on the same date", () => {
    const first = repository.create(company, { actorId: "researcher", idempotencyKey: "semantic-first", now: source.observedAt });
    const repeatedSource = {
      ...source,
      ref: "syndicated",
      title: "转载报道",
      url: "https://media.example.com/nova-funding",
      excerpt: "另一篇报道描述了同一家公司在同一天披露的同一轮产品及融资进展。",
    };
    const repeated = {
      ...company,
      externalId: "syndicated-export-id",
      discoveryReason: "媒体转载了同一项新品和融资进展。",
      investmentSummary: "这是对同一家公司、同一日期和同一信号的改写摘要，不应再次形成待审项目。投资亮点与待核问题均未发生变化，因此应该复用已有候选记录，避免投资经理在时间线中重复看到同一事项。",
      evidence: [repeatedSource],
      assertions: company.assertions.map((assertion) => ({ ...assertion, evidenceRefs: ["syndicated"] })),
      relationships: company.relationships.map((relationship) => ({ ...relationship, evidenceRefs: ["syndicated"] })),
      contacts: [],
      company: {
        ...company.company,
        fundingHistory: company.company.fundingHistory.map((funding) => ({ ...funding, sourceRefs: ["syndicated"] })),
        mergersAndAcquisitions: company.company.mergersAndAcquisitions.map((transaction) => ({ ...transaction, sourceRefs: ["syndicated"] })),
      },
    };

    const second = repository.create(repeated, { actorId: "researcher", idempotencyKey: "semantic-second", now: "2026-09-14T01:00:00.000Z" });

    expect(second.id).toBe(first.id);
    expect(repository.list({}).total).toBe(1);
  });

  it("uses strong entity keys for semantic dedupe without merging same-name companies in different cities", () => {
    const withoutCredit = { ...company.company, unifiedCreditCode: undefined };
    const websiteFirst = repository.create({ ...company, externalId: "website-first", name: "品牌甲", company: withoutCredit }, { actorId: "researcher", idempotencyKey: "website-first", now: source.observedAt });
    const websiteRepeat = repository.create({ ...company, externalId: "website-repeat", name: "品牌乙", company: withoutCredit }, { actorId: "researcher", idempotencyKey: "website-repeat", now: source.observedAt });
    expect(websiteRepeat.id).toBe(websiteFirst.id);

    const nameOnlyCompany = { ...withoutCredit, officialWebsite: undefined };
    const nameFirst = repository.create({ ...company, externalId: "name-first", name: "同名器件", city: "苏州", company: nameOnlyCompany }, { actorId: "researcher", idempotencyKey: "name-first", now: source.observedAt });
    const otherCity = repository.create({ ...company, externalId: "name-other-city", name: "同名器件", city: "上海", company: nameOnlyCompany }, { actorId: "researcher", idempotencyKey: "name-other-city", now: source.observedAt });
    const nameRepeat = repository.create({ ...company, externalId: "name-repeat", name: "同名器件", city: "苏州", company: nameOnlyCompany }, { actorId: "researcher", idempotencyKey: "name-repeat", now: source.observedAt });
    expect(otherCity.id).not.toBe(nameFirst.id);
    expect(nameRepeat.id).toBe(nameFirst.id);

    const person = {
      ...company, externalId: "person-first", entityType: "person" as const, name: "李研", signalType: "award", company: undefined,
      relationships: [], contacts: [], person: { organization: "未来实验室", education: [], employment: [], publications: [], patents: [] },
    };
    const personFirst = repository.create(person, { actorId: "researcher", idempotencyKey: "person-first", now: source.observedAt });
    const personRepeat = repository.create({ ...person, externalId: "person-repeat" }, { actorId: "researcher", idempotencyKey: "person-repeat", now: source.observedAt });
    expect(personRepeat.id).toBe(personFirst.id);

    const technology = {
      ...company, externalId: "technology-first", entityType: "technology" as const, name: "片上光互连", signalType: "technology_release", company: undefined,
      relationships: [], contacts: [], technology: { normalizedName: "片上光互连", definition: "片上光互连定义", maturity: "unknown" as const, keyMetrics: [], papers: [], patents: [], alternatives: [], competitors: [] },
    };
    const technologyFirst = repository.create(technology, { actorId: "researcher", idempotencyKey: "technology-first", now: source.observedAt });
    const technologyRepeat = repository.create({ ...technology, externalId: "technology-repeat" }, { actorId: "researcher", idempotencyKey: "technology-repeat", now: source.observedAt });
    expect(technologyRepeat.id).toBe(technologyFirst.id);
  });
});
