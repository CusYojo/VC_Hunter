import { requirePageUser } from "@/security/page-auth";
import { redirect } from "next/navigation";

export default async function SourcesPage() {
  await requirePageUser();
  redirect("/admin?view=sources");
}
