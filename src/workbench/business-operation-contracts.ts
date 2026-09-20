export type OperationKind = "fund" | "lp" | "portfolio" | "expense" | "invoice" | "payment" | "budget" | "contract" | "contact" | "expert";
export type OperationField = { key: string; label: string; type: "text" | "textarea" | "money" | "year" | "date" | "project" | "fund" | "documents"; required?: boolean };
export type OperationConfig = { label: string; statuses: Record<string, string>; fields: OperationField[] };
const money = (label: string, key = "amountCny", required = true): OperationField => ({ key, label, type: "money", required });
const text = (key: string, label: string, required = false): OperationField => ({ key, label, type: "text", required });
const date = (key: string, label: string, required = false): OperationField => ({ key, label, type: "date", required });
const relations: OperationField[] = [{ key: "projectId", label: "关联项目", type: "project" }, { key: "fundId", label: "关联基金", type: "fund" }, { key: "documentIds", label: "关联项目资料", type: "documents" }];
const notes: OperationField = { key: "notes", label: "备注 / 跟进记录", type: "textarea" };
export const operationConfigs: Record<OperationKind, OperationConfig> = {
  fund: { label: "基金", statuses: { raising: "募集中", active: "投资期", harvesting: "退出期", closed: "已清算" }, fields: [money("认缴金额（元）"), money("实缴金额（元）", "calledCny"), money("净资产 NAV（元）", "navCny"), { key: "vintage", label: "成立年份", type: "year", required: true }, relations[0], relations[2], notes] },
  lp: { label: "LP 跟进", statuses: { prospect: "潜在 LP", contacting: "沟通中", due_diligence: "尽调中", committed: "已承诺", contributed: "已出资", closed: "结束跟进" }, fields: [text("contact", "联系人 / 联系方式", true), money("承诺金额（元）", "amountCny", false), date("nextContactDate", "下次跟进"), ...relations, notes] },
  portfolio: { label: "投资组合", statuses: { holding: "持有中", exiting: "退出中", exited: "已退出" }, fields: [{ key: "projectId", label: "关联项目", type: "project", required: true }, { key: "fundId", label: "关联基金", type: "fund", required: true }, money("投资成本（元）"), money("当前估值（元）", "valuationCny"), date("occurredOn", "投资日期"), relations[2], notes] },
  expense: { label: "费用", statuses: { recorded: "已登记", submitted: "待核对", reimbursed: "已报销", cancelled: "已作废" }, fields: [money("费用金额（元）"), date("occurredOn", "发生日期", true), text("counterparty", "经办人 / 对方单位"), ...relations, notes] },
  invoice: { label: "发票", statuses: { received: "已收票", verified: "已核对", booked: "已入账", voided: "已作废" }, fields: [money("价税合计（元）"), text("invoiceNumber", "发票号码", true), text("counterparty", "开票方", true), date("occurredOn", "开票日期", true), ...relations, notes] },
  payment: { label: "付款记录", statuses: { planned: "计划付款", paid: "已付款（登记）", cancelled: "已取消" }, fields: [money("付款金额（元）"), text("counterparty", "收款方", true), date("dueDate", "计划付款日", true), date("paidOn", "实际付款日"), text("reference", "银行回单 / 付款凭证编号"), ...relations, notes] },
  budget: { label: "预算", statuses: { draft: "草稿", active: "执行中", closed: "已结束" }, fields: [money("预算金额（元）"), text("period", "预算期间（例如 2026 或 2026-Q3）", true), ...relations, notes] },
  contract: { label: "合同风险", statuses: { draft: "草稿", review: "审查中", returned: "待补充", effective: "已生效", closed: "已结束" }, fields: [text("counterparty", "合同对方", true), money("合同金额（元）", "amountCny", false), date("dueDate", "处理期限"), { key: "riskDetails", label: "风险事项 / 审查意见", type: "textarea" }, ...relations, notes] },
  contact: { label: "联系人", statuses: { active: "保持联系", follow_up: "待跟进", inactive: "暂停联系" }, fields: [text("organization", "所属机构"), text("contact", "联系方式", true), text("role", "职务 / 关系"), date("nextContactDate", "下次跟进"), ...relations, notes] },
  expert: { label: "专家", statuses: { available: "可联系", contacted: "已联系", engaged: "合作中", inactive: "暂停合作" }, fields: [text("organization", "所属机构"), text("expertise", "专业领域", true), text("contact", "联系方式", true), date("nextContactDate", "下次跟进"), ...relations, notes] },
};
export type OperationDocument = { id: string; originalName: string; kind: string; byteLength: number; createdAt: string; source: "upload" | "project"; projectId?: string; projectDocumentId?: string; projectName?: string };
export type OperationRecord = { id: string; kind: OperationKind; name: string; status: string; data: Record<string, string | number | string[]>; version: number; archived: boolean; createdAt: string; updatedAt: string; documents?: OperationDocument[] };
export type OperationWorkspace = { records: OperationRecord[]; canWrite: boolean; projects: { id: string; name: string }[]; funds: { id: string; name: string }[]; documents: { id: string; projectId: string; originalName: string }[] };
export function isOperationKind(value: string): value is OperationKind { return Object.hasOwn(operationConfigs, value); }
