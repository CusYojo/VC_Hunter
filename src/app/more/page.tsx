import { requirePageUser } from "@/security/page-auth";
import type { Metadata } from "next";
import Link from "next/link";
import { FolderArchive, Bot, CircleDollarSign, ContactRound, FlaskConical, Landmark, Settings2 } from "lucide-react";
import { HubHeader, HubPage } from "@/components/operating/hub-layout";

export const metadata: Metadata = { title: "更多业务中心" };

const destinations = [
  { href: "/all-projects", label: "全部项目", detail: "项目时间线、暂不跟进和历史线索", icon: FolderArchive },
  { href: "/research", label: "研究中心", detail: "报告、知识、技术情报和告警", icon: FlaskConical },
  { href: "/funds", label: "基金中心", detail: "基金、LP CRM 与 Portfolio", icon: Landmark },
  { href: "/finance", label: "财务中心", detail: "费用、发票、付款与预算", icon: CircleDollarSign },
  { href: "/resources", label: "资源中心", detail: "联系人、人物、机构与专家", icon: ContactRound },
  { href: "/ai", label: "AI 工作台", detail: "Copilot、Agent Runs 与 Studio", icon: Bot },
  { href: "/admin", label: "系统管理", detail: "用户、角色、Workflow 与审计", icon: Settings2 },
];

export default async function MorePage() {
  await requirePageUser();
  return <HubPage><HubHeader eyebrow="All centers" title="更多" description="进入移动端未固定展示的业务中心。" source="real" /><div className="grid gap-3 sm:grid-cols-2">{destinations.map((item) => <Link key={item.href} href={item.href} className="flex min-h-24 items-center gap-4 rounded-xl border bg-white p-4 transition-colors hover:bg-muted"><item.icon className="size-6 text-primary" aria-hidden="true" /><div><h2 className="font-semibold">{item.label}</h2><p className="mt-1 text-sm text-muted-foreground">{item.detail}</p></div></Link>)}</div></HubPage>;
}
