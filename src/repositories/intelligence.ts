import type { DatabaseSync } from "node:sqlite";
import type {
  InvestmentEventSummary,
  InvestorSummary,
  MaEventSummary,
  PersonEventSummary,
  PersonSummary,
  TopicKnowledgeCard,
  Track,
} from "@/domain/types";
import { mapInvestorRow } from "./investor-directory";

/**
 * 投资 / 并购 / 人才 / 知识卡 的只读数据访问。
 *
 * 这些视图只暴露规范化实体与已有人工复核边界；写路径由 service 层控制并挂证据。
 */

type Row = Record<string, string | number | null>;

export class SqliteIntelligenceRepository {
  constructor(private readonly database: DatabaseSync) {}

  // ── 投资者 ──────────────────────────────────────────────────────
  listInvestors(): InvestorSummary[] {
    const rows = this.database.prepare("SELECT * FROM investors ORDER BY name").all() as unknown as Row[];
    return rows.map((row) => mapInvestorRow(row, this.investmentCountForInvestor(String(row.id))));
  }

  findInvestor(id: string): InvestorSummary | undefined {
    const row = this.database.prepare("SELECT * FROM investors WHERE id = ?").get(id) as unknown as Row | undefined;
    if (!row) return undefined;
    return mapInvestorRow(row, this.investmentCountForInvestor(String(row.id)));
  }

  private investmentCountForInvestor(investorId: string): number {
    const row = this.database.prepare(
      `SELECT count(*) AS count FROM investment_events
       WHERE investors_json LIKE '%' || ? || '%'`,
    ).get(investorId) as { count: number };
    return row.count;
  }

  // ── 投资事件 ────────────────────────────────────────────────────
  listInvestmentEvents(): InvestmentEventSummary[] {
    const rows = this.database.prepare(`SELECT ie.*, c.legal_name AS company_name, c.id AS company_id,
        (SELECT p.track FROM projects p WHERE p.company_id = c.id LIMIT 1) AS track
      FROM investment_events ie JOIN companies c ON c.id = ie.company_id
      ORDER BY ie.announced_at DESC`).all() as unknown as Row[];
    return rows.map((row) => ({
      id: String(row.id),
      companyId: String(row.company_id),
      companyName: String(row.company_name),
      track: (row.track ? String(row.track) : "AI") as Track,
      round: String(row.round) as InvestmentEventSummary["round"],
      announcedAt: String(row.announced_at),
      amount: row.amount === null ? null : Number(row.amount),
      currency: row.currency ? (String(row.currency) as "CNY" | "USD") : null,
      disclosureType: String(row.disclosure_type) as InvestmentEventSummary["disclosureType"],
      investors: JSON.parse(String(row.investors_json)) as string[],
      leadInvestors: JSON.parse(String(row.lead_investors_json)) as string[],
      confidence: Number(row.confidence),
    }));
  }

  // ── 并购事件 ────────────────────────────────────────────────────
  listMaEvents(): MaEventSummary[] {
    const rows = this.database.prepare(`SELECT ma.*, c.legal_name AS target_name
      FROM ma_events ma JOIN companies c ON c.id = ma.target_company_id
      ORDER BY ma.announcement_date DESC`).all() as unknown as Row[];
    return rows.map((row) => ({
      id: String(row.id),
      targetCompanyId: String(row.target_company_id),
      targetName: String(row.target_name),
      acquirerName: String(row.acquirer_name),
      announcementDate: String(row.announcement_date),
      transactionType: String(row.transaction_type) as MaEventSummary["transactionType"],
      transactionValue: row.transaction_value === null ? null : Number(row.transaction_value),
      currency: row.currency ? (String(row.currency) as "CNY" | "USD") : null,
      transactionStage: String(row.transaction_stage) as MaEventSummary["transactionStage"],
      strategicRationale: row.strategic_rationale ? String(row.strategic_rationale) : null,
    }));
  }

  // ── 人才库 ──────────────────────────────────────────────────────
  listPeople(): PersonSummary[] {
    const rows = this.database.prepare(`SELECT p.*,
        (SELECT count(*) FROM person_events pe WHERE pe.person_id = p.id) AS career_events_24m
      FROM people p ORDER BY p.name`).all() as unknown as Row[];
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      aliases: JSON.parse(String(row.aliases_json)) as string[],
      currentOrganization: row.current_organization ? String(row.current_organization) : null,
      currentTitle: row.current_title ? String(row.current_title) : null,
      track: row.track ? (String(row.track) as Track) : null,
      companyRoles: this.companyRolesFor(String(row.id)),
      previousStartups: JSON.parse(String(row.previous_startups_json)) as string[],
      technicalEvidenceCount: Number(row.technical_evidence_count),
      careerEvents24m: Number(row.career_events_24m),
      privacyBasis: String(row.privacy_basis) as PersonSummary["privacyBasis"],
      confidence: Number(row.confidence),
    }));
  }

  listPeopleDetailed(includeContacts = false): Array<PersonSummary & {
    education: string[]; employment: string[]; technicalBackground: string | null; publications: string[]; patents: string[];
    homepage: string | null; reports: string[]; publicContacts: Array<{ type: string; value: string; sourceUrl: string; verifiedAt: string }>;
  }> {
    return this.listPeople().map((person) => {
      const details = this.database.prepare("SELECT * FROM person_profile_details WHERE person_id=?").get(person.id) as unknown as Row | undefined;
      const contacts = this.database.prepare("SELECT contact_type,contact_value,source_url,verified_at FROM entity_public_contacts WHERE entity_type='person' AND entity_id=? ORDER BY verified_at DESC").all(person.id) as unknown as Row[];
      return {
        ...person,
        education: details ? JSON.parse(String(details.education_json)) as string[] : [],
        employment: details ? JSON.parse(String(details.employment_json)) as string[] : [],
        technicalBackground: details?.technical_background ? String(details.technical_background) : null,
        publications: details ? JSON.parse(String(details.publications_json)) as string[] : [],
        patents: details ? JSON.parse(String(details.patents_json)) as string[] : [],
        homepage: details?.homepage ? String(details.homepage) : null,
        reports: details ? JSON.parse(String(details.reports_json)) as string[] : [],
        publicContacts: includeContacts ? contacts.map((contact) => ({ type: String(contact.contact_type), value: String(contact.contact_value), sourceUrl: String(contact.source_url), verifiedAt: String(contact.verified_at) })) : [],
      };
    });
  }

  findPerson(id: string): PersonSummary | undefined {
    const row = this.database.prepare(`SELECT p.*,
        (SELECT count(*) FROM person_events pe WHERE pe.person_id = p.id) AS career_events_24m
      FROM people p WHERE p.id = ?`).get(id) as unknown as Row | undefined;
    if (!row) return undefined;
    return {
      id: String(row.id),
      name: String(row.name),
      aliases: JSON.parse(String(row.aliases_json)) as string[],
      currentOrganization: row.current_organization ? String(row.current_organization) : null,
      currentTitle: row.current_title ? String(row.current_title) : null,
      track: row.track ? (String(row.track) as Track) : null,
      companyRoles: this.companyRolesFor(String(row.id)),
      previousStartups: JSON.parse(String(row.previous_startups_json)) as string[],
      technicalEvidenceCount: Number(row.technical_evidence_count),
      careerEvents24m: Number(row.career_events_24m),
      privacyBasis: String(row.privacy_basis) as PersonSummary["privacyBasis"],
      confidence: Number(row.confidence),
    };
  }

  private companyRolesFor(personId: string): Array<{ companyId: string; companyName: string; role: string }> {
    const rows = this.database.prepare(`SELECT pcr.company_id, c.legal_name AS company_name, pcr.role
      FROM person_company_roles pcr JOIN companies c ON c.id = pcr.company_id
      WHERE pcr.person_id = ?`).all(personId) as unknown as Row[];
    return rows.map((row) => ({ companyId: String(row.company_id), companyName: String(row.company_name), role: String(row.role) }));
  }

  listPersonEvents(): PersonEventSummary[] {
    const rows = this.database.prepare(`SELECT pe.*, p.name AS person_name, tc.legal_name AS target_company_name
      FROM person_events pe
      JOIN people p ON p.id = pe.person_id
      LEFT JOIN companies tc ON tc.id = pe.target_company_id
      ORDER BY pe.occurred_at DESC`).all() as unknown as Row[];
    return rows.map((row) => ({
      id: String(row.id),
      personId: String(row.person_id),
      personName: String(row.person_name),
      eventType: String(row.event_type) as PersonEventSummary["eventType"],
      occurredAt: String(row.occurred_at),
      summary: String(row.summary),
      targetCompanyName: row.target_company_name ? String(row.target_company_name) : null,
      confidence: Number(row.confidence),
      alertSeverity: row.alert_severity ? (String(row.alert_severity) as PersonEventSummary["alertSeverity"]) : null,
    }));
  }

  // ── 关键词知识卡 ────────────────────────────────────────────────
  listTopicKnowledgeCards(): TopicKnowledgeCard[] {
    const rows = this.database.prepare("SELECT * FROM topic_knowledge_cards ORDER BY hotness DESC, topic").all() as unknown as Row[];
    return rows.map((row) => ({
      id: String(row.id),
      topic: String(row.topic),
      track: row.track ? (String(row.track) as Track) : null,
      scope: String(row.scope) as TopicKnowledgeCard["scope"],
      summary: String(row.summary),
      definition: String(row.definition),
      keywords: JSON.parse(String(row.keywords_json)) as string[],
      hotness: Number(row.hotness),
      updatedAt: String(row.updated_at),
    }));
  }
}
