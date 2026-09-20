import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/workbench/team";
import { authenticationRequired } from "./identity-scope";
import { resolveWorkspaceIdentity } from "./workspace-session";

export async function requirePageUser() {
  if (!authenticationRequired()) return getCurrentUser();
  const identity = await resolveWorkspaceIdentity(await headers());
  if (!identity) redirect("/login");
  return identity.user;
}
