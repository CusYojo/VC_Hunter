"use client";
import { HubHeader, HubPage, HubTabs } from "./hub-layout";
import { OperationRecords } from "./operation-records";
const tabs = [{ id: "funds", label: "基金" }, { id: "lp", label: "LP CRM" }, { id: "portfolio", label: "投资组合" }];
export function FundsCenter({ initialView }: { initialView: string }) {
  const active = tabs.some((tab) => tab.id === initialView) ? initialView : "funds";
  return <HubPage><HubHeader eyebrow="Fund operations" title="基金中心" description="基金、LP 跟进和投资组合的真实业务台账。" source="real" /><HubTabs basePath="/funds" tabs={tabs} active={active} /><OperationRecords key={active} kind={active === "funds" ? "fund" : active === "lp" ? "lp" : "portfolio"} /></HubPage>;
}
