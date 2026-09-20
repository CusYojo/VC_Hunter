import { requirePageUser } from "@/security/page-auth";
import { redirect } from "next/navigation";

export default async function DiscoverPage() {
  await requirePageUser();
  redirect("/projects?view=discovery");
}
