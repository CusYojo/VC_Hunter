import type { PrototypeState } from "@/prototype/contracts";

const project = (id: string, label: string) => ({ id, type: "project" as const, label, href: `/projects/${id}` });
const fund = (id: string, label: string) => ({ id, type: "fund" as const, label, href: `/funds?selected=${id}` });
const trip = (id: string, label: string) => ({ id, type: "trip" as const, label, href: "/calendar" });

export const defaultPrototypeState: PrototypeState = {
  version: 1,
  persona: "investment_manager",
  workItems: [
    { id: "work-dd-robotics", title: "补齐具身机器人客户访谈", status: "in_progress", priority: "urgent", assignee: "示例经理", dueAt: "2026-09-03T10:00:00.000Z", project: project("project-embodied-ai", "灵巧智能"), response: "pending", source: "demo" },
    { id: "work-model-check", title: "复核航天项目收入模型", status: "todo", priority: "high", assignee: "周宁", dueAt: "2026-09-04T08:00:00.000Z", project: project("project-space", "星际动力"), source: "demo" },
    { id: "work-contract", title: "确认增资协议回购条款", status: "blocked", priority: "high", assignee: "林法务", dueAt: "2026-09-05T09:00:00.000Z", project: project("project-chip", "玄芯微电子"), source: "demo" },
    { id: "work-report", title: "发布先进制造周报", status: "done", priority: "medium", assignee: "陈研", dueAt: "2026-09-02T09:00:00.000Z", source: "demo" },
  ],
  approvals: [
    {
      id: "approval-ic-001", title: "灵巧智能 Pre-A 轮 IC 决策", requestType: "ic", status: "pending", applicant: "示例经理", currentApprover: "顾明远", submittedAt: "2026-09-02T07:30:00.000Z", amountCny: 30000000, entity: project("project-embodied-ai", "灵巧智能"), risk: "attention", summary: "申请投资 3,000 万元，投前估值 6.2 亿元；客户集中度与量产爬坡仍需作为交割条件。", trail: [{ id: "trail-ic-submit", actor: "示例经理", action: "submitted", note: "材料已齐备，提交 IC。", at: "2026-09-02T07:30:00.000Z" }], source: "demo",
    },
    {
      id: "approval-expense-002", title: "上海尽调差旅报销", requestType: "expense", status: "pending", applicant: "赵婧", currentApprover: "财务中心", submittedAt: "2026-09-01T10:20:00.000Z", amountCny: 4860.5, entity: project("project-chip", "玄芯微电子"), risk: "normal", summary: "关联 8 月 28 日上海供应链尽调，共 6 张凭证。", trail: [{ id: "trail-exp-submit", actor: "赵婧", action: "submitted", note: "已关联行程与会议纪要。", at: "2026-09-01T10:20:00.000Z" }], source: "demo",
    },
    {
      id: "approval-contract-003", title: "玄芯微电子增资协议用印", requestType: "seal", status: "returned", applicant: "示例经理", currentApprover: "林法务", submittedAt: "2026-08-31T03:10:00.000Z", entity: project("project-chip", "玄芯微电子"), risk: "high", summary: "回购触发条件表述与投决条件不一致，需补充版本对照。", trail: [{ id: "trail-seal-submit", actor: "示例经理", action: "submitted", note: "提交协议终稿。", at: "2026-08-31T03:10:00.000Z" }, { id: "trail-seal-return", actor: "林法务", action: "returned", note: "请补充红线版本与董事席位条款。", at: "2026-09-01T02:15:00.000Z" }], source: "demo",
    },
    { id: "approval-project-004", title: "星际动力项目立项", requestType: "project", status: "pending", applicant: "周宁", currentApprover: "投资总监", submittedAt: "2026-09-02T02:10:00.000Z", entity: project("project-space", "星际动力"), risk: "normal", summary: "申请进入正式研究，已附技术里程碑与创始团队背景。", trail: [{ id: "trail-project-submit", actor: "周宁", action: "submitted", note: "提交立项。", at: "2026-09-02T02:10:00.000Z" }], source: "demo" },
    { id: "approval-dd-005", title: "灵巧智能尽调启动", requestType: "dd", status: "approved", applicant: "示例经理", currentApprover: "投资总监", submittedAt: "2026-08-26T06:20:00.000Z", entity: project("project-embodied-ai", "灵巧智能"), risk: "normal", summary: "商业、技术、财务与法务尽调范围已确认。", trail: [{ id: "trail-dd-submit", actor: "示例经理", action: "submitted", note: "提交尽调计划。", at: "2026-08-26T06:20:00.000Z" }, { id: "trail-dd-approved", actor: "投资总监", action: "approved", note: "同意启动。", at: "2026-08-26T09:00:00.000Z" }], source: "demo" },
    { id: "approval-trip-006", title: "上海供应链尽调出差", requestType: "trip", status: "approved", applicant: "赵婧", currentApprover: "部门负责人", submittedAt: "2026-08-24T02:00:00.000Z", entity: project("project-chip", "玄芯微电子"), risk: "normal", summary: "8 月 28 日走访两家核心供应商并安排专家访谈。", trail: [{ id: "trail-trip-approved", actor: "部门负责人", action: "approved", note: "行程与预算已确认。", at: "2026-08-24T05:00:00.000Z" }], source: "demo" },
    { id: "approval-payment-007", title: "灵巧智能首期投资款请款", requestType: "payment", status: "pending", applicant: "财务中心", currentApprover: "顾明远", submittedAt: "2026-09-02T09:00:00.000Z", amountCny: 18000000, entity: project("project-embodied-ai", "灵巧智能"), risk: "attention", summary: "首期投资款，需确认交割先决条件与用印版本一致。", trail: [{ id: "trail-payment-submit", actor: "财务中心", action: "submitted", note: "提交付款审批。", at: "2026-09-02T09:00:00.000Z" }], source: "demo" },
    { id: "approval-contract-008", title: "专项法律顾问合同", requestType: "contract", status: "returned", applicant: "林法务", currentApprover: "运营负责人", submittedAt: "2026-08-30T04:00:00.000Z", amountCny: 120000, risk: "attention", summary: "服务范围缺少境外知识产权核查，已退回补充。", trail: [{ id: "trail-contract-return", actor: "运营负责人", action: "returned", note: "请补充境外核查范围。", at: "2026-08-30T06:00:00.000Z" }], source: "demo" },
    { id: "approval-purchase-009", title: "行业数据库年度采购", requestType: "purchase", status: "approved", applicant: "陈研", currentApprover: "运营负责人", submittedAt: "2026-08-20T02:00:00.000Z", amountCny: 86000, risk: "normal", summary: "用于研究团队产业链与专利数据检索。", trail: [{ id: "trail-purchase-approved", actor: "运营负责人", action: "approved", note: "预算内采购。", at: "2026-08-20T05:00:00.000Z" }], source: "demo" },
    { id: "approval-leave-010", title: "研究员年假申请", requestType: "leave", status: "approved", applicant: "陈研", currentApprover: "研究负责人", submittedAt: "2026-08-18T01:00:00.000Z", risk: "normal", summary: "9 月 7 日至 9 月 8 日，研究任务已完成交接。", trail: [{ id: "trail-leave-approved", actor: "研究负责人", action: "approved", note: "交接已确认。", at: "2026-08-18T03:00:00.000Z" }], source: "demo" },
  ],
  meetings: [
    { id: "meeting-001", title: "灵巧智能创始人访谈", startsAt: "2026-09-03T06:00:00.000Z", location: "杭州 · 3F 远见会议室", attendees: ["示例经理", "顾明远", "周宁"], project: project("project-embodied-ai", "灵巧智能"), response: "pending", summaryStatus: "scheduled", source: "demo" },
    { id: "meeting-002", title: "玄芯微电子法务专项", startsAt: "2026-09-03T09:00:00.000Z", location: "腾讯会议", attendees: ["示例经理", "林法务", "赵婧"], project: project("project-chip", "玄芯微电子"), response: "pending", summaryStatus: "processing", source: "demo" },
    { id: "meeting-003", title: "先进制造周度例会", startsAt: "2026-09-04T01:30:00.000Z", location: "北京 · 5F IC 室", attendees: ["投资团队"], summaryStatus: "ready", source: "demo" },
  ],
  funds: [
    { id: "fund-growth-ii", name: "硬科技成长二期基金", vintage: 2024, committedCny: 1500000000, calledPercent: 46, navCny: 810000000, dpi: 0.08, irrPercent: 16.4, portfolioCount: 11, source: "demo" },
    { id: "fund-seed-i", name: "前沿科技种子一期", vintage: 2022, committedCny: 500000000, calledPercent: 81, navCny: 612000000, dpi: 0.42, irrPercent: 23.7, portfolioCount: 18, source: "demo" },
  ],
  financeRecords: [
    { id: "finance-001", recordType: "expense", title: "上海尽调差旅报销", amountCny: 4860.5, status: "pending", occurredAt: "2026-09-01T10:20:00.000Z", fund: fund("fund-growth-ii", "硬科技成长二期基金"), project: project("project-chip", "玄芯微电子"), trip: trip("trip-shanghai-dd", "上海供应链尽调"), source: "demo" },
    { id: "finance-002", recordType: "payment", title: "灵巧智能首期投资款", amountCny: 18000000, status: "approved", occurredAt: "2026-09-02T06:00:00.000Z", fund: fund("fund-growth-ii", "硬科技成长二期基金"), project: project("project-embodied-ai", "灵巧智能"), source: "demo" },
    { id: "finance-003", recordType: "invoice", title: "专项法律顾问费发票", amountCny: 120000, status: "paid", occurredAt: "2026-08-28T02:40:00.000Z", fund: fund("fund-growth-ii", "硬科技成长二期基金"), source: "demo" },
    { id: "finance-004", recordType: "budget", title: "2026 年专家访谈预算", amountCny: 800000, status: "approved", occurredAt: "2026-01-05T03:00:00.000Z", source: "demo" },
  ],
  contracts: [
    { id: "contract-001", title: "玄芯微电子增资协议", counterparty: "玄芯微电子（杭州）有限公司", status: "review", riskCount: 3, owner: "林法务", updatedAt: "2026-09-01T02:15:00.000Z", project: project("project-chip", "玄芯微电子"), source: "demo" },
    { id: "contract-002", title: "灵巧智能保密协议", counterparty: "杭州灵巧智能科技有限公司", status: "effective", riskCount: 0, owner: "赵婧", updatedAt: "2026-08-29T04:00:00.000Z", project: project("project-embodied-ai", "灵巧智能"), source: "demo" },
  ],
  agentRuns: [
    { id: "run-001", agent: "行业研究 Agent", task: "更新具身智能产业链图谱", status: "running", startedAt: "2026-09-03T00:45:00.000Z", project: project("project-embodied-ai", "灵巧智能"), source: "demo" },
    { id: "run-002", agent: "尽调材料 Agent", task: "核验玄芯微电子 23 份资料", status: "needs_review", startedAt: "2026-09-02T08:20:00.000Z", durationSeconds: 1482, project: project("project-chip", "玄芯微电子"), source: "demo" },
    { id: "run-003", agent: "会议纪要 Agent", task: "生成法务专项会议纪要", status: "completed", startedAt: "2026-09-02T03:00:00.000Z", durationSeconds: 96, source: "demo" },
  ],
  workflows: [
    { id: "workflow-investment", name: "投资项目分级审批", enabled: true, trigger: "项目进入 IC", steps: [{ id: "step-1", label: "投资总监预审", approver: "项目所属投资总监", condition: "所有项目" }, { id: "step-2", label: "Partner 决策", approver: "轮值 Partner", condition: "投资额 ≤ 3,000 万元" }, { id: "step-3", label: "投委会表决", approver: "IC 委员", condition: "投资额 > 3,000 万元或高风险" }], source: "demo" },
    { id: "workflow-expense", name: "费用与付款审批", enabled: true, trigger: "报销或付款申请提交", steps: [{ id: "step-1", label: "负责人确认", approver: "成本中心负责人", condition: "所有申请" }, { id: "step-2", label: "财务复核", approver: "财务经理", condition: "金额 ≥ 5,000 元" }], source: "demo" },
  ],
};
