import type { Metadata } from "next";
import { requirePageUser } from "@/security/page-auth";
import { OrganizationWorkspace } from "@/components/organization/organization-workspace";

export const metadata: Metadata = { title: "组织架构" };
export default async function OrganizationPage() {
  await requirePageUser();
  return <OrganizationWorkspace mode="public" />;
}
