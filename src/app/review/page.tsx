import { requirePageUser } from "@/security/page-auth";
import { redirect } from "next/navigation";

export default async function ReviewPage() {
  await requirePageUser();
  redirect("/projects?view=review");
}
