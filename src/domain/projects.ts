import { TRACK_VALUES, type LeadStatus, type ProjectSummary, type Track } from "./types";

export const TRACKS = [...TRACK_VALUES];

export interface ProjectFilters {
  track?: Track | "all";
  status?: LeadStatus | "all";
  query?: string;
}

export function filterProjects(projects: readonly ProjectSummary[], filters: ProjectFilters): ProjectSummary[] {
  const normalizedQuery = filters.query?.trim().toLocaleLowerCase("zh-CN") ?? "";

  return projects.filter((project) => {
    const matchesTrack = !filters.track || filters.track === "all" || project.track === filters.track;
    const matchesStatus = !filters.status || filters.status === "all" || project.status === filters.status;
    const matchesQuery =
      !normalizedQuery ||
      [project.name, project.legalName, project.subtrack ?? ""].some((value) =>
        value.toLocaleLowerCase("zh-CN").includes(normalizedQuery),
      );
    return matchesTrack && matchesStatus && matchesQuery;
  });
}
