import type { Metadata } from "next";
import "./tailwind.css";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { headers } from "next/headers";
import { authenticationRequired } from "@/security/identity-scope";
import { resolveWorkspaceIdentity } from "@/security/workspace-session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "VC Hunter", template: "%s | VC Hunter" },
  description: "证据优先的中国硬科技项目发现与投研工作台",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const authenticated = authenticationRequired();
  const identity = authenticated ? await resolveWorkspaceIdentity(await headers()) : null;
  return <html lang="zh-CN"><body><AppShell authenticated={authenticated} user={identity?.user ?? null} canManageOrganization={identity?.roles.includes("org_admin") ?? false}>{children}</AppShell></body></html>;
}
