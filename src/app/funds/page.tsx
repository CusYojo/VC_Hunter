import { requirePageUser } from "@/security/page-auth";
import type { Metadata } from "next";
import { FundsCenter } from "@/components/operating/funds-center";

export const metadata: Metadata = { title: "基金中心" };

export default async function FundsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageUser();
  const value = (await searchParams).view;
  return <FundsCenter initialView={typeof value === "string" ? value : "funds"} />;
}
