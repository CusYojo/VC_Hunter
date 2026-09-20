import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  DEMO_AS_OF,
  DEMO_INVESTMENT_EVENTS,
  DEMO_INVESTORS,
  DEMO_MA_EVENTS,
  DEMO_PEOPLE,
  DEMO_PERSON_EVENTS,
  DEMO_PROJECTS,
  DEMO_TOPIC_KNOWLEDGE,
  KNOWLEDGE_CARDS,
} from "@/fixtures/demo-data";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export function seedDemoData(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const insertSource = database.prepare(`INSERT OR IGNORE INTO sources
      (id,name,source_type,authority,access_mode,robots_status,license_notes,policy_status,independent_group,last_checked_at,access_class,allow_external_model,terms_review_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertDocument = database.prepare(`INSERT OR IGNORE INTO documents
      (id,source_id,canonical_url,title,published_at,observed_at,content_hash,raw_excerpt)
      VALUES (?,?,?,?,?,?,?,?)`);
    const insertEvidence = database.prepare(`INSERT OR IGNORE INTO evidence_fragments
      (id,document_id,quoted_context,fragment_hash) VALUES (?,?,?,?)`);
    const insertCompany = database.prepare(`INSERT OR IGNORE INTO companies
      (id,legal_name,aliases_json,official_domain,region_scope) VALUES (?,?,?,?,?)`);
    const insertProject = database.prepare(`INSERT OR IGNORE INTO projects
      (id,company_id,name,track,subtrack,discovery_at,discovery_reason,status,executive_summary,technology_stage,urgency_score,quality_score,evidence_quality,owner,signal_type,latest_event_at,risk_flags_json,open_questions_json,version,last_researched_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertAssertion = database.prepare(`INSERT OR IGNORE INTO assertions
      (id,project_id,predicate,label,value_status,epistemic_type,value_json,unit,null_reason,confidence,extraction_method,model_version,status,valid_from,valid_to)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const linkEvidence = database.prepare(`INSERT OR IGNORE INTO assertion_evidence
      (assertion_id,evidence_id,relation) VALUES (?,?,?)`);
    const insertEvent = database.prepare(`INSERT OR IGNORE INTO events
      (id,project_id,event_type,occurred_at,title,summary,confidence,evidence_id) VALUES (?,?,?,?,?,?,?,?)`);
    const insertAlert = database.prepare(`INSERT OR IGNORE INTO alerts
      (id,project_id,event_id,severity,reason,status,dedupe_key,created_at) VALUES (?,?,?,?,?,?,?,?)`);

    for (const project of DEMO_PROJECTS) {
      const evidenceId = `evidence-${project.id}`;
      insertSource.run(project.source.id, project.source.name, project.source.type, project.source.authority, "fixture", "not_applicable", "仅用于离线演示，不代表真实外部事实；允许发送至测试模型。", "approved", project.source.independentGroup, DEMO_AS_OF, "public", 1, "reviewed");
      insertDocument.run(project.document.id, project.source.id, project.document.url, project.document.title, project.document.publishedAt, DEMO_AS_OF, hash(project.document.quote), project.document.quote);
      insertEvidence.run(evidenceId, project.document.id, project.document.quote, hash(`${project.document.id}:${project.document.quote}`));
      insertCompany.run(project.companyId, project.legalName, JSON.stringify([project.name]), null, "CN-mainland");
      insertProject.run(project.id, project.companyId, project.name, project.track, project.subtrack, project.document.publishedAt, project.whyNow, "new", project.summary, project.stage, project.urgency, project.quality, project.evidenceQuality, null, project.signalType, project.document.publishedAt, JSON.stringify(project.riskFlags), JSON.stringify(project.openQuestions), 1, DEMO_AS_OF);

      const milestoneAssertionId = `assertion-${project.id}-milestone`;
      insertAssertion.run(milestoneAssertionId, project.id, "technology_milestone", "技术里程碑", "known", "fact", JSON.stringify(project.milestone), null, null, project.evidenceQuality, "fixture_rule", "deterministic-v1", "active", project.document.publishedAt, null);
      linkEvidence.run(milestoneAssertionId, evidenceId, "supports");

      const revenueAssertionId = `assertion-${project.id}-revenue`;
      insertAssertion.run(revenueAssertionId, project.id, "revenue", "营收", "not_disclosed", "fact", null, "CNY", "公开演示材料未披露营收，不能推定为零。", 0.9, "fixture_rule", "deterministic-v1", "active", null, null);
      linkEvidence.run(revenueAssertionId, evidenceId, "supports");

      const eventId = `event-${project.id}`;
      insertEvent.run(eventId, project.id, project.signalType, project.document.publishedAt, project.document.title, project.whyNow, project.evidenceQuality, evidenceId);
      insertAlert.run(`alert-${project.id}`, project.id, eventId, project.urgency >= 85 ? "high" : "medium", project.whyNow, "new", `${project.id}:${project.signalType}:${project.document.publishedAt}`, project.document.publishedAt);
    }

    seedFundingConflict(database);
    seedKnowledgeCards(database);
    seedInvestors(database);
    seedInvestmentEvents(database);
    seedMaEvents(database);
    seedPeople(database);
    seedPersonEvents(database);
    seedTopicKnowledge(database);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function seedFundingConflict(database: DatabaseSync): void {
  database.prepare(`INSERT OR IGNORE INTO sources
    (id,name,source_type,authority,access_mode,robots_status,license_notes,policy_status,independent_group,last_checked_at,access_class,allow_external_model,terms_review_status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run("source-qiongxin-media", "演示科技媒体", "media", "C", "fixture", "not_applicable", "仅用于演示冲突断言；允许发送至测试模型。", "approved", "media-qiongxin", DEMO_AS_OF, "public", 1, "reviewed");
  const quote = "演示媒体报道称，本轮融资金额接近人民币 1 亿元。";
  database.prepare(`INSERT OR IGNORE INTO documents
    (id,source_id,canonical_url,title,published_at,observed_at,content_hash,raw_excerpt) VALUES (?,?,?,?,?,?,?,?)`).run("doc-qiongxin-media", "source-qiongxin-media", "https://example.com/demo/qiongxin-media", "穹芯微电子融资报道（演示）", "2026-08-30T07:10:00+08:00", DEMO_AS_OF, hash(quote), quote);
  database.prepare("INSERT OR IGNORE INTO evidence_fragments (id,document_id,quoted_context,fragment_hash) VALUES (?,?,?,?)").run("evidence-qiongxin-media", "doc-qiongxin-media", quote, hash(`doc-qiongxin-media:${quote}`));

  const companyAssertion = "assertion-project-qiongxin-funding-company";
  const mediaAssertion = "assertion-project-qiongxin-funding-media";
  const insertAssertion = database.prepare(`INSERT OR IGNORE INTO assertions
    (id,project_id,predicate,label,value_status,epistemic_type,value_json,unit,null_reason,confidence,extraction_method,model_version,status,valid_from,valid_to)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insertAssertion.run(companyAssertion, "project-qiongxin", "funding_amount", "融资金额", "known", "fact", JSON.stringify(120000000), "CNY", null, 0.96, "fixture_rule", "deterministic-v1", "active", "2026-08-30", null);
  insertAssertion.run(mediaAssertion, "project-qiongxin", "funding_amount", "融资金额", "known", "fact", JSON.stringify(100000000), "CNY", null, 0.62, "fixture_rule", "deterministic-v1", "disputed", "2026-08-30", null);
  const link = database.prepare("INSERT OR IGNORE INTO assertion_evidence (assertion_id,evidence_id,relation) VALUES (?,?,?)");
  link.run(companyAssertion, "evidence-project-qiongxin", "supports");
  link.run(mediaAssertion, "evidence-qiongxin-media", "supports");
}

function seedKnowledgeCards(database: DatabaseSync): void {
  const insert = database.prepare(`INSERT OR IGNORE INTO knowledge_cards
    (id,track,definition,routes_json,milestones_json,keywords_json,query_templates_json,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`);
  for (const [track, definition, routes, milestones, keywords] of KNOWLEDGE_CARDS) {
    insert.run(`knowledge-${track}`, track, definition, JSON.stringify(routes), JSON.stringify(milestones), JSON.stringify(keywords), JSON.stringify([`${track} + 融资`, `${keywords[0]} + 客户验证`, `${keywords[1]} + 专利`]), DEMO_AS_OF);
  }
}

function seedInvestors(database: DatabaseSync): void {
  const insert = database.prepare(`INSERT OR IGNORE INTO investors
    (id,name,aliases_json,type,headquarters,focus_tracks_json,stage_focus_json,track_performance_json,created_at,
     institution_type,status,priority,investment_style,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,'active',2,?,?)`);
  for (const investor of DEMO_INVESTORS) {
    const institutionType = investor.type === "vc" ? "financial_vc" : investor.type === "government_fund" ? "local_government" : investor.type;
    insert.run(investor.id, investor.name, JSON.stringify(investor.aliases), investor.type, investor.headquarters, JSON.stringify(investor.focusTracks), JSON.stringify(investor.stageFocus), JSON.stringify(investor.trackPerformance), DEMO_AS_OF, institutionType, "演示机构，用于展示名录与投资历史结构。", DEMO_AS_OF);
  }
}

function seedInvestmentEvents(database: DatabaseSync): void {
  const insert = database.prepare(`INSERT OR IGNORE INTO investment_events
    (id,company_id,round,announced_at,amount,currency,disclosure_type,investors_json,lead_investors_json,confidence,source_refs_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const event of DEMO_INVESTMENT_EVENTS) {
    insert.run(event.id, event.companyId, event.round, event.announcedAt, event.amount, event.currency, event.disclosureType, JSON.stringify(event.investors), JSON.stringify(event.leadInvestors), event.confidence, JSON.stringify(["demo-source"]), DEMO_AS_OF);
  }
}

function seedMaEvents(database: DatabaseSync): void {
  const insert = database.prepare(`INSERT OR IGNORE INTO ma_events
    (id,target_company_id,acquirer_name,announcement_date,transaction_type,transaction_value,currency,transaction_stage,strategic_rationale,source_refs_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  for (const event of DEMO_MA_EVENTS) {
    insert.run(event.id, event.targetCompanyId, event.acquirerName, event.announcementDate, event.transactionType, event.transactionValue, event.currency, event.transactionStage, event.strategicRationale, JSON.stringify(["demo-source"]), DEMO_AS_OF);
  }
}

function seedPeople(database: DatabaseSync): void {
  const insertPerson = database.prepare(`INSERT OR IGNORE INTO people
    (id,name,aliases_json,current_organization,current_title,track,previous_startups_json,technical_evidence_count,privacy_basis,confidence,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insertRole = database.prepare(`INSERT OR IGNORE INTO person_company_roles (person_id,company_id,role) VALUES (?,?,?)`);
  for (const person of DEMO_PEOPLE) {
    insertPerson.run(person.id, person.name, JSON.stringify(person.aliases), person.currentOrganization, person.currentTitle, person.track, JSON.stringify(person.previousStartups), person.technicalEvidenceCount, person.privacyBasis, person.confidence, DEMO_AS_OF);
    for (const role of person.companyRoles) {
      insertRole.run(person.id, role.companyId, role.role);
    }
  }
}

function seedPersonEvents(database: DatabaseSync): void {
  const insert = database.prepare(`INSERT OR IGNORE INTO person_events
    (id,person_id,event_type,occurred_at,summary,target_company_id,confidence,alert_severity,evidence_id,dedupe_key,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  for (const event of DEMO_PERSON_EVENTS) {
    insert.run(event.id, event.personId, event.eventType, event.occurredAt, event.summary, event.targetCompanyId, event.confidence, event.alertSeverity, null, `${event.personId}:${event.eventType}:${event.occurredAt}:${event.targetCompanyId ?? "none"}`, DEMO_AS_OF);
  }
}

function seedTopicKnowledge(database: DatabaseSync): void {
  const insert = database.prepare(`INSERT OR IGNORE INTO topic_knowledge_cards
    (id,topic,track,scope,summary,definition,keywords_json,hotness,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  for (const card of DEMO_TOPIC_KNOWLEDGE) {
    insert.run(card.id, card.topic, card.track, card.scope, card.summary, card.definition, JSON.stringify(card.keywords), card.hotness, DEMO_AS_OF);
  }
}
