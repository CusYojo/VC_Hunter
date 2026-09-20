import type { Metadata } from "next";
import { requirePageUser } from "@/security/page-auth";
import { AISettings } from "@/components/ai/ai-settings";
export const metadata: Metadata = { title: "个人设置" };
export const dynamic = "force-dynamic";
export default async function SettingsPage() { await requirePageUser(); return <AISettings />; }
