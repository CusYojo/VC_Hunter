import { requirePageUser } from "@/security/page-auth";
import type { Metadata } from "next";
import { FinanceCenter } from "@/components/operating/finance-center";

export const metadata: Metadata = { title: "财务中心" };

export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageUser();
  const value = (await searchParams).view;
  return <FinanceCenter initialView={typeof value === "string" ? value : "expenses"} />;
}
