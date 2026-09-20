import { requirePageUser } from "@/security/page-auth";
import { redirect } from "next/navigation";

export default async function TalentPage() {
  await requirePageUser();
  redirect("/resources?view=people");
}
