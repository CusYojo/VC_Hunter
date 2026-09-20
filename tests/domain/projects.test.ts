import { describe, expect, it } from "vitest";
import { filterProjects, TRACKS } from "@/domain/projects";
import type { ProjectSummary } from "@/domain/types";

describe("project discovery", () => {
  it("keeps the seven required tracks in the taxonomy", () => {
    expect(TRACKS).toHaveLength(7);
    expect(TRACKS).toEqual(expect.arrayContaining(["AI", "具身智能", "半导体", "核聚变", "生物医药", "商业航天", "新材料"]));
  });

  it("filters projects by track, status, and search text without mutating input", () => {
    const projects = [
      { id: "p1", name: "穹芯微电子", legalName: "穹芯微电子（上海）有限公司", track: "半导体", status: "new", urgencyScore: 88 },
      { id: "p2", name: "曜石聚变", legalName: "曜石聚变能源科技有限公司", track: "核聚变", status: "researching", urgencyScore: 76 },
    ] as ProjectSummary[];
    const original = structuredClone(projects);

    expect(filterProjects(projects, { track: "半导体", status: "new", query: "穹芯" })).toEqual([projects[0]]);
    expect(projects).toEqual(original);
  });
});
