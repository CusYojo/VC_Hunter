import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { businessOperationsMigration } from "@/db/business-operations-migration";
import { createOperation, updateOperation, listOperations, getOperationWorkspace } from "@/workbench/business-operations";
let db: DatabaseSync;
const actor = { tenantId: "org-a", id: "user-a", roles: ["investment_manager"] };
const fund = { name: "真实基金", status: "raising", data: { amountCny: 1000000, calledCny: 0, navCny: 0, vintage: 2026, notes: "首轮募集" } };
beforeEach(() => { db = createDatabase(":memory:"); initializeDatabase(db); seedDemoData(db); if (!db.prepare("SELECT name FROM sqlite_master WHERE name='business_operation_records'").get()) db.exec(businessOperationsMigration.upSql); });
afterEach(() => db.close());
describe("persistent business operation records", () => {
  it("starts empty and saves records scoped to the authenticated tenant", () => {
    expect(listOperations(db, actor, "fund")).toEqual([]);
    const created = createOperation(db, actor, "fund", fund, "new-fund");
    expect(listOperations(db, actor, "fund")[0]).toMatchObject({ id: created.id, name: "真实基金", version: 1 });
    expect(listOperations(db, { ...actor, tenantId: "org-b" }, "fund")).toEqual([]);
    expect(createOperation(db, actor, "fund", fund, "new-fund").id).toBe(created.id);
    expect(() => createOperation(db, actor, "fund", { ...fund, name: "变化" }, "new-fund")).toThrow("幂等键");
  });
  it("requires write permission and rejects invalid fields, amounts and statuses", () => {
    expect(() => createOperation(db, { ...actor, roles: ["viewer"] }, "fund", fund, "v")).toThrow("权限");
    for (const input of [{ ...fund, name: " " }, { ...fund, status: "paid" }, { ...fund, actorId: "spoof" }, { ...fund, data: { ...fund.data, amountCny: -1 } }, { ...fund, data: { ...fund.data, amountCny: 1.001 } }]) expect(() => createOperation(db, actor, "fund", input, "bad")).toThrow();
  });
  it("updates with optimistic version checks and retains archived records", () => {
    const item = createOperation(db, actor, "fund", fund, "new");
    const updated = updateOperation(db, actor, "fund", item.id, { ...fund, name: "正式基金", version: 1 });
    expect(updated).toMatchObject({ name: "正式基金", version: 2 });
    expect(() => updateOperation(db, actor, "fund", item.id, { ...fund, version: 1 })).toThrow("版本冲突");
    expect(() => updateOperation(db, { ...actor, tenantId: "other" }, "fund", item.id, { version: 2, archived: true })).toThrow("不存在");
    updateOperation(db, actor, "fund", item.id, { version: 2, archived: true });
    expect(listOperations(db, actor, "fund")).toHaveLength(0);
    expect(listOperations(db, actor, "fund", true)[0]).toMatchObject({ archived: true, version: 3 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM business_operation_audit").get()?.n).toBe(3);
  });
  it("validates fund/project/document links and paid-record evidence", () => {
    expect(() => createOperation(db, actor, "portfolio", { name: "投资", status: "holding", data: { fundId: "foreign", projectId: "project-qiongxin", amountCny: 100 } }, "p")).toThrow();
    const created = createOperation(db, actor, "fund", fund, "fund");
    const portfolio = createOperation(db, actor, "portfolio", { name: "投资", status: "holding", data: { fundId: created.id, projectId: "project-qiongxin", amountCny: 100, valuationCny: 100 } }, "portfolio");
    expect(portfolio.data.fundId).toBe(created.id);
    expect(() => createOperation(db, actor, "expense", { name: "费用", status: "recorded", data: { amountCny: 1, projectId: "project-qiongxin", documentIds: ["missing"], occurredOn: "2026-09-04" } }, "doc")).toThrow();
    expect(() => createOperation(db, actor, "payment", { name: "付款", status: "paid", data: { amountCny: 1, counterparty: "对方", dueDate: "2026-09-04" } }, "paid")).toThrow();
    expect(getOperationWorkspace(db, { ...actor, roles: ["viewer"] }, "fund").canWrite).toBe(false);
  });
  it("lets a fund link project materials through the shared document selector", () => {
    const created = createOperation(db, actor, "fund", { ...fund, data: { ...fund.data, projectId: "project-qiongxin", documentIds: [] } }, "fund-project");
    expect(created.data.projectId).toBe("project-qiongxin");
  });
  it("prevents archiving a fund still referenced by active operations", () => {
    const created = createOperation(db, actor, "fund", fund, "fund");
    createOperation(db, actor, "lp", { name: "LP", status: "prospect", data: { contact: "联系人", fundId: created.id } }, "lp");
    expect(() => updateOperation(db, actor, "fund", created.id, { version: 1, archived: true })).toThrow("仍关联");
  });
  it("rejects sub-cent precision, invalid dates and cross-tenant fund links", () => {
    expect(() => createOperation(db, actor, "expense", { name: "费", status: "recorded", data: { amountCny: 0.000001, occurredOn: "2026-09-04" } }, "precision")).toThrow();
    expect(() => createOperation(db, actor, "expense", { name: "费", status: "recorded", data: { amountCny: 1, occurredOn: "2026-02-30" } }, "date")).toThrow();
    const foreign = createOperation(db, { ...actor, tenantId: "other" }, "fund", fund, "fund");
    expect(() => createOperation(db, actor, "lp", { name: "LP", status: "prospect", data: { contact: "联系人", fundId: foreign.id } }, "lp")).toThrow("基金不存在");
  });
  it.each([
    ["contact", { name: "联系人", status: "active", data: { contact: "公开渠道" } }],
    ["expert", { name: "专家", status: "available", data: { contact: "公开渠道", expertise: "工艺技术" } }],
    ["lp", { name: "LP机构", status: "prospect", data: { contact: "联系人", amountCny: 100, nextContactDate: "2026-10-01" } }],
    ["expense", { name: "差旅", status: "recorded", data: { amountCny: 0.07, occurredOn: "2026-09-04" } }],
    ["invoice", { name: "发票", status: "received", data: { amountCny: 100, counterparty: "开票方", invoiceNumber: "INV-1", occurredOn: "2026-09-04" } }],
    ["payment", { name: "付款登记", status: "paid", data: { amountCny: 100, counterparty: "收款方", dueDate: "2026-09-04", paidOn: "2026-09-04", reference: "BANK-1" } }],
    ["budget", { name: "年度预算", status: "active", data: { amountCny: 100000, period: "2026" } }],
    ["contract", { name: "服务协议", status: "review", data: { counterparty: "合作方", riskDetails: "需确认交付条件" } }],
  ])("persists %s record without demo data", (kind, input) => { expect(createOperation(db, actor, kind, input, kind).name).toBe(input.name); });
});
