import type { Metadata } from "next";
import { requirePageUser } from "@/security/page-auth";
import { OfficeWorkspace } from "@/components/organization/office/office-workspace";

export const metadata: Metadata = { title: "团队办公室" };
export default async function OfficePage() {
  await requirePageUser();
  return <OfficeWorkspace />;
}
