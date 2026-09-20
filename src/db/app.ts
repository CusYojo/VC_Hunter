import { getDatabase } from "./client";
import { SqliteProjectRepository } from "@/repositories/projects";
import { SqliteIntelligenceRepository } from "@/repositories/intelligence";
import { SqliteInvestorDirectoryRepository } from "@/repositories/investor-directory";
import { SqliteDealTimelineRepository } from "@/workbench/deal-timeline";
import { loadTeamMembers } from "@/workbench/team";

export function getAppRepository(): SqliteProjectRepository {
  return new SqliteProjectRepository(getDatabase());
}

export function getIntelligenceRepository(): SqliteIntelligenceRepository {
  return new SqliteIntelligenceRepository(getDatabase());
}

export function getInvestorDirectoryRepository(): SqliteInvestorDirectoryRepository {
  return new SqliteInvestorDirectoryRepository(getDatabase());
}

export function getDealTimelineRepository(): SqliteDealTimelineRepository {
  return new SqliteDealTimelineRepository(getDatabase(), loadTeamMembers());
}

export function getAppDatabase() {
  return getDatabase();
}
