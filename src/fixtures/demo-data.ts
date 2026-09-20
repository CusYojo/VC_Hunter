import type { InvestorSummary, MaEventSummary, PersonEventType, SourceAuthority, TopicKnowledgeCard, Track } from "@/domain/types";

export interface DemoProjectFixture {
  id: string;
  companyId: string;
  name: string;
  legalName: string;
  track: Track;
  subtrack: string;
  summary: string;
  whyNow: string;
  stage: string;
  signalType: string;
  urgency: number;
  quality: number;
  evidenceQuality: number;
  riskFlags: string[];
  openQuestions: string[];
  source: {
    id: string;
    name: string;
    authority: SourceAuthority;
    type: string;
    independentGroup: string;
  };
  document: {
    id: string;
    title: string;
    url: string;
    publishedAt: string;
    quote: string;
  };
  milestone: string;
}

export const DEMO_AS_OF = "2026-08-30T07:42:00+08:00";

export const DEMO_PROJECTS: readonly DemoProjectFixture[] = [
  {
    id: "project-xinglan",
    companyId: "company-xinglan",
    name: "星澜智算（演示）",
    legalName: "星澜智算科技（北京）有限公司（演示）",
    track: "AI",
    subtrack: "端侧推理",
    summary: "面向工业终端的低功耗推理运行时，当前重点验证软硬件协同效率。",
    whyNow: "演示公告披露首个制造业现场验证，技术从原型进入客户试点。",
    stage: "pilot",
    signalType: "technology_milestone",
    urgency: 86,
    quality: 74,
    evidenceQuality: 0.94,
    riskFlags: ["客户集中度待核验"],
    openQuestions: ["现场验证的持续时长与付费模式是什么？", "关键算子性能是否经第三方复现？"],
    source: { id: "source-xinglan", name: "星澜智算演示公告", authority: "A", type: "company_announcement", independentGroup: "company-xinglan" },
    document: { id: "doc-xinglan", title: "工业端侧推理系统完成首轮现场验证（演示）", url: "https://example.com/demo/xinglan", publishedAt: "2026-08-29T09:00:00+08:00", quote: "公司宣布端侧推理系统已在两条演示产线完成连续验证。" },
    milestone: "制造业场景客户试点",
  },
  {
    id: "project-bianjie",
    companyId: "company-bianjie",
    name: "边界机器人（演示）",
    legalName: "边界具身智能（深圳）有限公司（演示）",
    track: "具身智能",
    subtrack: "灵巧手与数据采集",
    summary: "研发高自由度灵巧手与遥操作数据闭环，处于集成原型验证阶段。",
    whyNow: "核心控制负责人公开加入团队，同时新增多模态遥操作岗位。",
    stage: "integrated_prototype",
    signalType: "talent_change",
    urgency: 82,
    quality: 71,
    evidenceQuality: 0.88,
    riskFlags: ["人才事件需持续交叉验证"],
    openQuestions: ["灵巧手寿命测试基准是什么？", "数据采集是否形成可复用资产？"],
    source: { id: "source-bianjie", name: "边界机器人演示招聘页", authority: "B", type: "company_careers", independentGroup: "company-bianjie" },
    document: { id: "doc-bianjie", title: "机器人控制与遥操作团队扩招（演示）", url: "https://example.com/demo/bianjie", publishedAt: "2026-08-28T14:30:00+08:00", quote: "招聘页新增灵巧手控制、遥操作平台和数据工程岗位。" },
    milestone: "集成原型与数据闭环",
  },
  {
    id: "project-qiongxin",
    companyId: "company-qiongxin",
    name: "穹芯微电子（演示）",
    legalName: "穹芯微电子（上海）有限公司（演示）",
    track: "半导体",
    subtrack: "先进封装",
    summary: "聚焦 Chiplet 互连与先进封装测试，工程样品进入客户验证。",
    whyNow: "工程样品送测与新一轮融资同时出现，但融资金额存在来源冲突。",
    stage: "customer_qualification",
    signalType: "funding_detected",
    urgency: 94,
    quality: 81,
    evidenceQuality: 0.91,
    riskFlags: ["融资金额来源冲突", "量产良率未披露"],
    openQuestions: ["客户验证覆盖哪些封装平台？", "融资金额应以哪一方最终披露为准？"],
    source: { id: "source-qiongxin", name: "穹芯微电子演示公告", authority: "A", type: "company_announcement", independentGroup: "company-qiongxin" },
    document: { id: "doc-qiongxin", title: "完成新一轮融资并启动客户送测（演示）", url: "https://example.com/demo/qiongxin", publishedAt: "2026-08-30T06:30:00+08:00", quote: "公司称本轮融资规模为人民币 1.2 亿元，资金用于先进封装测试线。" },
    milestone: "工程样品客户验证",
  },
  {
    id: "project-yaoshi",
    companyId: "company-yaoshi",
    name: "曜石聚变（演示）",
    legalName: "曜石聚变能源科技有限公司（演示）",
    track: "核聚变",
    subtrack: "高温超导磁体",
    summary: "研发面向聚变装置的高温超导磁体子系统，完成低温环境组件测试。",
    whyNow: "演示测试记录显示关键组件达到下一阶段集成条件。",
    stage: "subsystem_validation",
    signalType: "technology_milestone",
    urgency: 78,
    quality: 77,
    evidenceQuality: 0.96,
    riskFlags: ["系统级验证尚未完成"],
    openQuestions: ["磁体在循环载荷下的退化情况如何？", "下一轮集成装置时间表是什么？"],
    source: { id: "source-yaoshi", name: "曜石聚变演示测试记录", authority: "A", type: "company_technical_update", independentGroup: "company-yaoshi" },
    document: { id: "doc-yaoshi", title: "高温超导磁体组件完成低温测试（演示）", url: "https://example.com/demo/yaoshi", publishedAt: "2026-08-27T10:00:00+08:00", quote: "演示磁体组件在目标低温环境完成通流与机械稳定性测试。" },
    milestone: "磁体子系统验证",
  },
  {
    id: "project-chengming",
    companyId: "company-chengming",
    name: "澄明生物（演示）",
    legalName: "澄明生物医药（苏州）有限公司（演示）",
    track: "生物医药",
    subtrack: "双特异性抗体",
    summary: "开发实体瘤双特异性抗体候选物，处于临床前候选确认阶段。",
    whyNow: "候选分子完成关键药效研究，团队开始招聘临床与注册岗位。",
    stage: "preclinical",
    signalType: "paper_detected",
    urgency: 73,
    quality: 69,
    evidenceQuality: 0.89,
    riskFlags: ["临床转化风险", "专利自由实施待核验"],
    openQuestions: ["IND 申报前还需完成哪些安全性研究？", "核心专利地域覆盖如何？"],
    source: { id: "source-chengming", name: "澄明生物演示研究摘要", authority: "B", type: "research_preprint", independentGroup: "research-chengming" },
    document: { id: "doc-chengming", title: "候选双抗分子的临床前研究摘要（演示）", url: "https://example.com/demo/chengming", publishedAt: "2026-08-25T08:00:00+08:00", quote: "研究摘要报告了候选分子在演示模型中的药效与初步安全窗口。" },
    milestone: "临床前候选确认",
  },
  {
    id: "project-tiansun",
    companyId: "company-tiansun",
    name: "天隼航天（演示）",
    legalName: "天隼商业航天科技有限公司（演示）",
    track: "商业航天",
    subtrack: "液体火箭发动机",
    summary: "研制可重复使用液体发动机关键组件，地面热试进入长程验证。",
    whyNow: "最新演示热试持续时间提升，距离整机飞行验证更近一步。",
    stage: "ground_qualification",
    signalType: "technology_milestone",
    urgency: 84,
    quality: 76,
    evidenceQuality: 0.93,
    riskFlags: ["飞行履历为空", "供应链可靠性待核验"],
    openQuestions: ["重复点火次数是否达到设计目标？", "整机适配计划如何？"],
    source: { id: "source-tiansun", name: "天隼航天演示试验公告", authority: "A", type: "company_announcement", independentGroup: "company-tiansun" },
    document: { id: "doc-tiansun", title: "液体发动机完成长程地面热试（演示）", url: "https://example.com/demo/tiansun", publishedAt: "2026-08-29T18:20:00+08:00", quote: "发动机演示件完成本阶段最长持续时间的地面热试。" },
    milestone: "地面长程热试",
  },
  {
    id: "project-xuantao",
    companyId: "company-xuantao",
    name: "玄陶新材（演示）",
    legalName: "玄陶先进材料（宁波）有限公司（演示）",
    track: "新材料",
    subtrack: "先进陶瓷",
    summary: "面向半导体设备的先进陶瓷部件，完成中试线与首批客户验证。",
    whyNow: "中试产能上线并获得设备客户小批验证订单。",
    stage: "pilot_manufacturing",
    signalType: "customer_order",
    urgency: 80,
    quality: 79,
    evidenceQuality: 0.92,
    riskFlags: ["批量一致性待验证"],
    openQuestions: ["小批订单的复购条件是什么？", "关键粉体是否依赖单一供应商？"],
    source: { id: "source-xuantao", name: "玄陶新材演示公告", authority: "A", type: "company_announcement", independentGroup: "company-xuantao" },
    document: { id: "doc-xuantao", title: "先进陶瓷中试线投入运行（演示）", url: "https://example.com/demo/xuantao", publishedAt: "2026-08-26T11:10:00+08:00", quote: "中试线已投入运行，首批演示部件进入设备客户小批验证。" },
    milestone: "中试与客户小批验证",
  },
];

export const KNOWLEDGE_CARDS = [
  ["AI", "模型、数据、算力基础设施及垂直应用形成的技术生态", ["基础模型", "AI Infra", "端侧模型"], ["benchmark", "prototype", "pilot", "production customer"], ["多模态", "推理加速", "RAG"]],
  ["具身智能", "感知、决策、控制、机电系统和机器人数据闭环", ["本体", "执行器", "数据闭环"], ["单部件", "集成原型", "场景测试", "客户部署"], ["VLA", "灵巧手", "遥操作"]],
  ["半导体", "设计、制造、设备、材料、封测及新型器件", ["设计", "制造", "先进封装"], ["design", "tapeout", "engineering sample", "mass production"], ["EDA", "Chiplet", "SiC"]],
  ["核聚变", "聚变装置、磁体、材料、加热与燃料循环工程系统", ["磁体", "装置", "燃料循环"], ["component", "subsystem", "integrated device"], ["托卡马克", "REBCO", "偏滤器"]],
  ["生物医药", "药物发现、临床开发、生产与监管全过程", ["发现", "临床", "注册"], ["discovery", "preclinical", "Phase I", "approval"], ["ADC", "双抗", "CGT"]],
  ["商业航天", "发射、卫星制造、有效载荷、地面站和空间应用", ["运载", "卫星", "空间应用"], ["component", "ground qualification", "flight test"], ["液体发动机", "SAR", "星座"]],
  ["新材料", "通过材料性能突破驱动新产业和关键设备升级", ["材料制备", "中试", "量产"], ["实验室", "中试", "客户验证", "批量制造"], ["先进陶瓷", "固态电解质", "超导材料"]],
] as const;

// ── 投资者演示数据（名称均为虚构示例） ──────────────────────────
export const DEMO_INVESTORS: Array<{
  id: string;
  name: string;
  aliases: string[];
  type: InvestorSummary["type"];
  headquarters: string | null;
  focusTracks: Track[];
  stageFocus: string[];
  trackPerformance: Record<string, { invested: number; followOnRate: number | null; exits: number }>;
}> = [
  { id: "investor-chenxing", name: "晨星创投（演示）", aliases: ["晨星资本（演示）"], type: "vc", headquarters: "北京", focusTracks: ["AI", "半导体"], stageFocus: ["天使", "Pre-A", "A"], trackPerformance: { AI: { invested: 21, followOnRate: 0.38, exits: 3 }, 半导体: { invested: 17, followOnRate: 0.41, exits: 2 } } },
  { id: "investor-hanjing", name: "瀚景资本（演示）", aliases: [], type: "vc", headquarters: "上海", focusTracks: ["生物医药", "新材料"], stageFocus: ["A", "B"], trackPerformance: { 生物医药: { invested: 26, followOnRate: 0.46, exits: 4 }, 新材料: { invested: 9, followOnRate: 0.22, exits: 1 } } },
  { id: "investor-guoyun", name: "国运硬科技基金（演示）", aliases: ["国运产业基金（演示）"], type: "government_fund", headquarters: "合肥", focusTracks: ["核聚变", "商业航天", "半导体"], stageFocus: ["战略投资", "A", "B"], trackPerformance: { 核聚变: { invested: 6, followOnRate: 0.5, exits: 0 }, 商业航天: { invested: 12, followOnRate: 0.33, exits: 1 }, 半导体: { invested: 15, followOnRate: 0.27, exits: 0 } } },
  { id: "investor-tianqi", name: "天启产业资本（演示）", aliases: [], type: "cvc", headquarters: "深圳", focusTracks: ["具身智能", "AI"], stageFocus: ["A", "B", "战略投资"], trackPerformance: { 具身智能: { invested: 14, followOnRate: 0.36, exits: 1 }, AI: { invested: 11, followOnRate: 0.45, exits: 1 } } },
];

// ── 投资事件演示数据 ─────────────────────────────────────────────
export const DEMO_INVESTMENT_EVENTS: Array<{
  id: string;
  companyId: string;
  round: "angel" | "pre_a" | "a" | "b" | "c" | "d_plus" | "strategic" | "other";
  announcedAt: string;
  amount: number | null;
  currency: "CNY" | "USD" | null;
  disclosureType: "exact" | "range" | "undisclosed" | "estimated";
  investors: string[];
  leadInvestors: string[];
  confidence: number;
}> = [
  { id: "inv-qiongxin-b", companyId: "company-qiongxin", round: "b", announcedAt: "2026-08-30", amount: 120000000, currency: "CNY", disclosureType: "exact", investors: ["investor-chenxing", "investor-guoyun"], leadInvestors: ["investor-chenxing"], confidence: 0.96 },
  { id: "inv-xinglan-a", companyId: "company-xinglan", round: "a", announcedAt: "2026-06-18", amount: 80000000, currency: "CNY", disclosureType: "exact", investors: ["investor-chenxing"], leadInvestors: ["investor-chenxing"], confidence: 0.92 },
  { id: "inv-bianjie-pre-a", companyId: "company-bianjie", round: "pre_a", announcedAt: "2026-05-09", amount: null, currency: null, disclosureType: "undisclosed", investors: ["investor-tianqi"], leadInvestors: [], confidence: 0.71 },
  { id: "inv-yaoshi-strategic", companyId: "company-yaoshi", round: "strategic", announcedAt: "2026-04-22", amount: 300000000, currency: "CNY", disclosureType: "range", investors: ["investor-guoyun"], leadInvestors: ["investor-guoyun"], confidence: 0.88 },
  { id: "inv-chengming-a", companyId: "company-chengming", round: "a", announcedAt: "2025-12-11", amount: 150000000, currency: "CNY", disclosureType: "exact", investors: ["investor-hanjing"], leadInvestors: ["investor-hanjing"], confidence: 0.9 },
  { id: "inv-xuantao-b", companyId: "company-xuantao", round: "b", announcedAt: "2025-11-03", amount: 200000000, currency: "CNY", disclosureType: "exact", investors: ["investor-hanjing", "investor-guoyun"], leadInvestors: ["investor-hanjing"], confidence: 0.91 },
];

// ── 并购事件演示数据 ─────────────────────────────────────────────
export const DEMO_MA_EVENTS: Array<{
  id: string;
  targetCompanyId: string;
  acquirerName: string;
  announcementDate: string;
  transactionType: MaEventSummary["transactionType"];
  transactionValue: number | null;
  currency: "CNY" | "USD" | null;
  transactionStage: MaEventSummary["transactionStage"];
  strategicRationale: string | null;
}> = [
  { id: "ma-tiansun-strategic", targetCompanyId: "company-tiansun", acquirerName: "演示航天集团", announcementDate: "2026-07-15", transactionType: "strategic_investment", transactionValue: 500000000, currency: "CNY", transactionStage: "approved", strategicRationale: "布局可重复使用液体火箭发动机关键组件供应链（演示）" },
  { id: "ma-xuantao-asset", targetCompanyId: "company-xuantao", acquirerName: "演示半导体设备集团", announcementDate: "2025-10-28", transactionType: "asset_purchase", transactionValue: null, currency: null, transactionStage: "closed", strategicRationale: "收购某先进陶瓷中试资产，扩充设备零部件自给能力（演示）" },
];

// ── 人才库演示数据 ───────────────────────────────────────────────
export const DEMO_PEOPLE: Array<{
  id: string;
  name: string;
  aliases: string[];
  currentOrganization: string | null;
  currentTitle: string | null;
  track: Track | null;
  previousStartups: string[];
  technicalEvidenceCount: number;
  privacyBasis: "public_statement" | "registry_record" | "professional_profile" | "paper_authorship" | "patent_applicant";
  confidence: number;
  companyRoles: Array<{ companyId: string; role: string }>;
}> = [
  { id: "person-weiyuan", name: "魏远（演示）", aliases: ["Wei Yuan（演示）"], currentOrganization: "边界机器人（演示）", currentTitle: "首席科学家", track: "具身智能", previousStartups: [], technicalEvidenceCount: 14, privacyBasis: "paper_authorship", confidence: 0.94, companyRoles: [{ companyId: "company-bianjie", role: "首席科学家" }] },
  { id: "person-linzhi", name: "林之（演示）", aliases: [], currentOrganization: "演示国家实验室", currentTitle: "研究员", track: "核聚变", previousStartups: [], technicalEvidenceCount: 21, privacyBasis: "paper_authorship", confidence: 0.96, companyRoles: [] },
  { id: "person-shenyan", name: "沈研（演示）", aliases: ["Shen Yan（演示）"], currentOrganization: null, currentTitle: null, track: "半导体", previousStartups: ["演示 EDA 初创"], technicalEvidenceCount: 8, privacyBasis: "registry_record", confidence: 0.82, companyRoles: [] },
];

// ── 人才事件演示数据 ─────────────────────────────────────────────
export const DEMO_PERSON_EVENTS: Array<{
  id: string;
  personId: string;
  eventType: PersonEventType;
  occurredAt: string;
  summary: string;
  targetCompanyId: string | null;
  confidence: number;
  alertSeverity: "high" | "medium" | "review";
}> = [
  { id: "pe-weiyuan-joined", personId: "person-weiyuan", eventType: "joined_company", occurredAt: "2026-08-28", summary: "公开声明加入边界机器人担任首席科学家，专注灵巧手与遥操作（演示）", targetCompanyId: "company-bianjie", confidence: 0.93, alertSeverity: "medium" },
  { id: "pe-shenyan-started", personId: "person-shenyan", eventType: "started_company", occurredAt: "2026-08-15", summary: "工商新设公司与人物存在高置信关联，疑似启动新 EDA 创业项目（演示）", targetCompanyId: null, confidence: 0.78, alertSeverity: "high" },
  { id: "pe-linzhi-paper", personId: "person-linzhi", eventType: "paper_published", occurredAt: "2026-08-02", summary: "以第一作者身份发表高温超导磁体相关预印本（演示）", targetCompanyId: null, confidence: 0.9, alertSeverity: "review" },
];

// ── 关键词知识卡演示数据 ─────────────────────────────────────────
export const DEMO_TOPIC_KNOWLEDGE: Array<{
  id: string;
  topic: string;
  track: Track | null;
  scope: TopicKnowledgeCard["scope"];
  summary: string;
  definition: string;
  keywords: string[];
  hotness: number;
}> = [
  { id: "topic-vla", topic: "VLA（视觉-语言-动作模型）", track: "具身智能", scope: "topic", summary: "把视觉、语言与动作联合建模，是当前具身智能的技术卡点之一。", definition: "VLA（Vision-Language-Action）模型将视觉感知、语言指令与机器人动作输出统一建模，使机器人能够直接依据指令与观察生成控制动作，代表路线包括 RT 系列与国产同类模型。", keywords: ["VLA", "视觉语言动作", "具身大模型", "机器人基础模型", "模仿学习"], hotness: 94 },
  { id: "topic-chiplet", topic: "Chiplet 先进封装", track: "半导体", scope: "topic", summary: "后摩尔时代通过封装集成分散 die 的关键技术路线。", definition: "Chiplet 将一颗大芯片拆分为多颗小芯片（die），通过先进封装与互连技术重新集成，以突破单芯片面积与良率限制，核心环节包括互连协议、2.5D/3D 封装与测试。", keywords: ["Chiplet", "芯粒", "先进封装", "UCIe", "2.5D", "TSV"], hotness: 89 },
  { id: "topic-rebco", topic: "REBCO 高温超导带材", track: "核聚变", scope: "topic", summary: "紧凑型聚变装置强磁场磁体的关键材料，也是产能卡点。", definition: "REBCO（稀土钡铜氧）涂层导体是第二代高温超导带材，可在较高温度与强磁场下工作，是紧凑型托卡马克与仿星器磁体的核心材料，其批量化制备与成本是产业化瓶颈。", keywords: ["REBCO", "高温超导", "涂层导体", "磁体", "YBCO"], hotness: 86 },
  { id: "topic-adc", topic: "ADC 抗体偶联药物", track: "生物医药", scope: "topic", summary: "肿瘤治疗领域交易与融资持续活跃的药物形式。", definition: "ADC（Antibody-Drug Conjugate）通过连接子将细胞毒性小分子偶联到靶向抗体上，实现精准递送，当前竞争焦点集中在新型载荷、连接子与双抗 ADC 平台。", keywords: ["ADC", "抗体偶联药物", "payload", "linker", "双抗ADC"], hotness: 83 },
  { id: "topic-liquid-engine", topic: "可重复使用液体火箭发动机", track: "商业航天", scope: "topic", summary: "降低进入空间成本、支撑星座组网的核心技术。", definition: "可重复使用液体火箭发动机通过多次点火与回收再使用降低单次发射成本，关键技术包括深度变推力、长程热试与复用寿命验证，是国内商业航天竞争焦点。", keywords: ["液体发动机", "可重复使用", "变推力", "热试", "复用"], hotness: 81 },
];
