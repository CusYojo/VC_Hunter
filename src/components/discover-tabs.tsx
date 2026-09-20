"use client";

import { Tab, TabList, TabPanel, TabPanels, Tabs } from "@/components/ui/legacy";
import { DiscoveryWorkbench } from "@/components/discovery-workbench";
import { FundingDashboard } from "@/components/funding-dashboard";
import type { FundingDashboardData } from "@/components/funding-dashboard";
import { InvestorDirectory } from "@/components/investor-directory";
import type { CandidateView } from "@/workbench/candidate-details";
import { IntelligenceDiscoveryWorkbench } from "@/components/intelligence-discovery-workbench";
import type { IntelligencePlanView } from "@/components/intelligence-discovery-workbench";
import type { IntelligenceCandidateView } from "@/intelligence/repository";

interface DiscoveryJobView { id: string; status: string; query: { query: string }; createdAt: string; workflow?: { version: string } }
interface DirectoryInvestor { id: string; name: string; englishName: string | null; institutionType: string; headquarters: string | null; focusTracks: string[]; subtracks: string[]; investmentStyle: string | null; status: string; priority: number; rank: number | null; portfolioCount: number; fundSize: { text: string } | null }

export function DiscoverTabs({ dashboard, investorNames, directory, directoryTotal, jobs, candidates, intelligenceCandidates, intelligenceTotal, intelligencePlans, team, currentUser, searchMode, canAdmin = false, canReview = false, recentScopeKey }: {
  canAdmin?: boolean;
  canReview?: boolean;
  searchMode?: "local-index" | "deepseek-web-search" | "exa";
  dashboard: FundingDashboardData;
  investorNames: Record<string, string>;
  directory: DirectoryInvestor[];
  directoryTotal: number;
  jobs: DiscoveryJobView[];
  candidates: CandidateView[];
  intelligenceCandidates: IntelligenceCandidateView[];
  intelligenceTotal: number;
  intelligencePlans: IntelligencePlanView[];
  team: Array<{ id: string; name: string; departmentId?: string | null; departmentName?: string | null }>;
  currentUser: string;
  recentScopeKey?: string;
}) {
  return (
    <Tabs>
      <TabList aria-label="项目发现页签" contained fullWidth>
        <Tab>项目发现</Tab>
        <Tab>投融资信号</Tab>
        <Tab>机构名录</Tab>
      </TabList>
      <TabPanels>
        <TabPanel><DiscoveryWorkbench canAdmin={canAdmin} canReview={canReview} searchMode={searchMode} jobs={jobs} candidates={candidates} intelligenceCandidates={intelligenceCandidates} team={team} currentUser={currentUser} recentScopeKey={recentScopeKey} intelligenceTools={<IntelligenceDiscoveryWorkbench initialCandidates={intelligenceCandidates} initialTotal={intelligenceTotal} initialPlans={intelligencePlans} canAdmin={canAdmin} canReview={canReview} display="tools" />} /></TabPanel>
        <TabPanel><FundingDashboard data={dashboard} investorNames={investorNames} /></TabPanel>
        <TabPanel><InvestorDirectory initial={directory} total={directoryTotal} /></TabPanel>
      </TabPanels>
    </Tabs>
  );
}
