"use client";

import dynamic from "next/dynamic";
import type { AgentSearchPlanView, DiscoveryCandidateView, ProjectCandidateView, SourceView, WebSearchLeadView } from "@/repositories/dashboard-data";

const ClientOnlyTables = dynamic(
  () => import("./source-ops-tables").then((module) => module.SourceOpsTables),
  { ssr: false, loading: () => <p>正在加载 Source Ops…</p> },
);

export function SourceOpsClient(props: { sources: SourceView[]; candidates: DiscoveryCandidateView[]; webLeads: WebSearchLeadView[]; agentPlans: AgentSearchPlanView[]; projectCandidates: ProjectCandidateView[] }) {
  return <ClientOnlyTables {...props} />;
}
