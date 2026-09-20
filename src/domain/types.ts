export const TRACK_VALUES = [
  "AI",
  "具身智能",
  "半导体",
  "核聚变",
  "生物医药",
  "商业航天",
  "新材料",
] as const;

export type Track = (typeof TRACK_VALUES)[number];
export type LeadStatus = "new" | "researching" | "contacting" | "dd" | "ic" | "pass" | "invested" | "exited";
export type ValueStatus = "known" | "unknown" | "not_disclosed" | "not_applicable" | "estimated";
export type EpistemicType = "fact" | "estimate" | "inference" | "opinion";
export type SourceAuthority = "A" | "B" | "C" | "D";

export interface ProjectSummary {
  id: string;
  name: string;
  legalName: string;
  track: Track;
  subtrack?: string;
  status: LeadStatus;
  urgencyScore?: number;
  qualityScore?: number;
  evidenceQuality?: number;
  evidenceAuthority?: SourceAuthority;
  whyNow?: string;
  owner?: string | null;
  owners?: string[];
  signalType?: string;
  eventAt?: string;
  riskFlags?: string[];
}

export type InvestorType = "vc" | "pe" | "cvc" | "government_fund" | "incubator" | "other";
export type RoundLabel = "angel" | "pre_a" | "a" | "b" | "c" | "d_plus" | "strategic" | "other";
export type AmountDisclosure = "exact" | "range" | "undisclosed" | "estimated";
export type MaTransactionType = "acquisition" | "merger" | "asset_purchase" | "strategic_investment";
export type MaStage = "proposed" | "approved" | "closed" | "terminated";
export type PersonEventType =
  | "joined_company"
  | "left_company"
  | "started_company"
  | "became_advisor"
  | "paper_published"
  | "patent_filed"
  | "executive_hiring"
  | "public_profile_changed";
export type PrivacyBasis = "public_statement" | "registry_record" | "professional_profile" | "paper_authorship" | "patent_applicant";
export type KnowledgeScope = "track" | "topic";

/** 机构名录的细分类型；与旧 `InvestorType` 并存，旧字段只用于兼容。 */
export const INSTITUTION_TYPE_VALUES = ["financial_vc", "cvc", "local_government", "pe", "national_fund", "incubator", "other"] as const;
export type InstitutionType = (typeof INSTITUTION_TYPE_VALUES)[number];
/** 名录状态机：seed_candidate → verified → active；paused / merged 为停用态。未核实机构不得进入每日监控。 */
export const INVESTOR_STATUS_VALUES = ["seed_candidate", "verified", "active", "paused", "merged"] as const;
export type InvestorStatus = (typeof INVESTOR_STATUS_VALUES)[number];
/** 1=头部必看 / 2=重点 / 3=观察 */
export type InvestorPriority = 1 | 2 | 3;

export interface InvestorKeyPerson { name: string; title?: string | null; focusTracks?: string[] }
export interface InvestorPortfolioSample { company: string; track?: string | null; year?: number | null; round?: string | null }
export interface InvestorFundSize { amount: number | null; currency: string | null; text: string; source?: string | null }
export interface InvestorVerification { verifiedAt: string | null; verifiedBy: string | null; notes: string }

export interface InvestorSummary {
  id: string;
  name: string;
  englishName: string | null;
  aliases: string[];
  type: InvestorType;
  institutionType: InstitutionType;
  headquarters: string | null;
  focusTracks: Track[];
  subtracks: string[];
  stageFocus: string[];
  investmentStyle: string | null;
  thesis: string | null;
  keyPeople: InvestorKeyPerson[];
  portfolioSample: InvestorPortfolioSample[];
  fundSize: InvestorFundSize | null;
  sourceRefs: string[];
  status: InvestorStatus;
  priority: InvestorPriority;
  rank: number | null;
  verification: InvestorVerification | null;
  notes: string;
  portfolioCount: number;
  trackPerformance: Record<string, { invested: number; followOnRate: number | null; exits: number }>;
  version: number;
  createdAt: string;
  updatedAt: string | null;
}

export interface InvestmentEventSummary {
  id: string;
  companyId: string;
  companyName: string;
  track: Track;
  round: RoundLabel;
  announcedAt: string;
  amount: number | null;
  currency: "CNY" | "USD" | null;
  disclosureType: AmountDisclosure;
  investors: string[];
  leadInvestors: string[];
  confidence: number;
}

export interface MaEventSummary {
  id: string;
  targetCompanyId: string;
  targetName: string;
  acquirerName: string;
  announcementDate: string;
  transactionType: MaTransactionType;
  transactionValue: number | null;
  currency: "CNY" | "USD" | null;
  transactionStage: MaStage;
  strategicRationale: string | null;
}

export interface PersonSummary {
  id: string;
  name: string;
  aliases: string[];
  currentOrganization: string | null;
  currentTitle: string | null;
  track: Track | null;
  companyRoles: Array<{ companyId: string; companyName: string; role: string }>;
  previousStartups: string[];
  technicalEvidenceCount: number;
  careerEvents24m: number;
  privacyBasis: PrivacyBasis;
  confidence: number;
}

export interface PersonEventSummary {
  id: string;
  personId: string;
  personName: string;
  eventType: PersonEventType;
  occurredAt: string;
  summary: string;
  targetCompanyName: string | null;
  confidence: number;
  alertSeverity: "high" | "medium" | "review" | null;
}

export interface TopicKnowledgeCard {
  id: string;
  topic: string;
  track: Track | null;
  scope: KnowledgeScope;
  summary: string;
  definition: string;
  keywords: string[];
  hotness: number;
  updatedAt: string;
}

export interface SourceSignal {
  authority: SourceAuthority;
  primary?: boolean;
  independentGroup: string;
  explicitStatement?: boolean;
}
