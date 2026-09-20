"use client";
import { HubHeader, HubPage, HubTabs } from "./hub-layout";
import { OperationRecords } from "./operation-records";
import type { OperationKind } from "@/workbench/business-operation-contracts";
const tabs = [{ id: "expenses", label: "费用" }, { id: "invoices", label: "发票" }, { id: "payments", label: "付款" }, { id: "budget", label: "预算" }, { id: "contracts", label: "合同风险" }];
const kinds: Record<string, OperationKind> = { expenses: "expense", invoices: "invoice", payments: "payment", budget: "budget", contracts: "contract" };
export function FinanceCenter({ initialView }: { initialView: string }) {
  const active = tabs.some((tab) => tab.id === initialView) ? initialView : "expenses";
  return <HubPage><HubHeader eyebrow="Finance operations" title="财务中心" description="费用、发票、付款、预算及合同记录。" source="real" /><HubTabs basePath="/finance" tabs={tabs} active={active} /><OperationRecords key={active} kind={kinds[active]} /></HubPage>;
}
