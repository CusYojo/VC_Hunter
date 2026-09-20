import { requirePageUser } from "@/security/page-auth";
import type { Metadata } from "next";
import { AiCenter } from "@/components/operating/ai-center";

export const metadata: Metadata = { title: "AI 工作台" };

export default async function AiPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageUser();
  const value = (await searchParams).view;
  return <AiCenter initialView={typeof value === "string" ? value : "copilot"} />;
}
