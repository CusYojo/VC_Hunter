import { describe, expect, it } from "vitest";
import { buildProjectCatalog, filterProjectCatalog, projectCatalogFiltersSchema } from "@/workbench/project-catalog";
import type { ProjectSummary } from "@/domain/types";
import type { CandidateView } from "@/workbench/candidate-details";
const project = (id: string, status: ProjectSummary["status"], latestAt = "2026-09-04T01:00:00Z") => ({ id, name: id, legalName: id, track: "AI" as const, status, owners: ["甲", "乙"], latestAt, latestProgress: "最新进展" });
const candidate = (id: string, extra: Partial<CandidateView> = {}): CandidateView => ({ id, companyName: id, track: "半导体", investorNames: [], signalType: "manual_upload", summary: "原始资料", confidence: null, status: "pending_review", version: 1, lead: { title: id, url: "", publishedAt: null }, projectId: null, createdAt: "2026-09-03T02:00:00Z", ...extra });
describe("all project catalog", () => {
  it("classifies stages and retains dismissed and archived candidates without duplicating promoted projects", () => {
    const projects = [project("new", "new"), project("dd", "dd"), project("invested", "invested"), project("exited", "exited"), project("pass", "pass")];
    const rows = buildProjectCatalog(projects, [candidate("dismissed", { status: "dismissed" }), candidate("archived", { archivedAt: "2026-09-04T08:00:00Z" }), candidate("promoted", { status: "promoted", projectId: "dd" })]);
    expect(Object.fromEntries(rows.map(r => [r.id, r.category]))).toEqual({ new: "following", dd: "following", invested: "invested", exited: "exited", pass: "stopped", dismissed: "other", archived: "other" });
    expect(rows.find(r => r.id === "dismissed")?.statusLabel).toBe("暂不跟进");
    expect(rows.find(r => r.id === "pass")?.statusLabel).toBe("暂不跟进");
  });
  it("sorts actual instants descending, has stable ties and keeps unknown dates last without mutating input", () => {
    const source = [project("older", "dd", "2026-09-04T10:00:00+08:00"), project("newer", "dd", "2026-09-04T03:00:00Z"), project("unknown", "dd", "invalid"), project("tie", "dd", "2026-09-04T03:00:00Z")];
    expect(filterProjectCatalog(buildProjectCatalog(source, [])).map(r => r.id)).toEqual(["newer", "tie", "older", "unknown"]);
    expect(source[0].id).toBe("older");
  });
  it("combines classification, track, inclusive Shanghai dates, and any responsible person", () => {
    const rows = buildProjectCatalog([project("at-start", "dd", "2026-09-03T16:00:00Z"), project("at-end", "dd", "2026-09-04T15:59:59Z"), project("too-early", "dd", "2026-09-03T15:59:59Z"), project("too-late", "dd", "2026-09-04T16:00:00Z"), project("closed", "pass")], [candidate("unassigned")]);
    expect(filterProjectCatalog(rows, { category: "following", track: "AI", owner: "乙", from: "2026-09-04", to: "2026-09-04" }).map(r => r.id)).toEqual(["at-end", "at-start"]);
    expect(filterProjectCatalog(rows, { owner: "unassigned" }).map(r => r.id)).toEqual(["unassigned"]);
    expect(filterProjectCatalog(rows, { track: "半导体", q: "原始" }).map(r => r.id)).toEqual(["unassigned"]);
  });
  it("rejects malformed dates, reversed ranges, invalid categories and oversized search", () => {
    for (const filters of [{ from: "2026-02-30" }, { from: "2026-09-06", to: "2026-09-05" }, { category: "invalid" }, { q: "a".repeat(201) }]) expect(projectCatalogFiltersSchema.safeParse(filters).success).toBe(false);
  });
  it("uses candidate review time and retains unresolved promoted references instead of dropping data", () => {
    const rows = buildProjectCatalog([], [candidate("reviewed", { reviewedAt: "2026-09-05T02:00:00Z" }), candidate("orphan", { status: "promoted", projectId: "missing" })]);
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.id === "reviewed")?.latestAt).toBe("2026-09-05T02:00:00Z");
  });
  it("does not repeat the same company event across legacy and comprehensive discoveries", () => {
    const legacy = candidate("legacy", { companyName: "同一项目", signalType: "融资", eventDate: "2026-09-04" });
    const rows = buildProjectCatalog([], [legacy], [{ id: "intelligence", name: "同一项目", track: "半导体", subtrack: "芯片", city: "上海", signalType: "funding", eventDate: "2026-09-04", status: "pending_review", summary: "更全面的同一融资信息", createdAt: "2026-09-04T03:00:00Z" }]);
    expect(rows.filter((row) => row.name === "同一项目")).toHaveLength(1);
  });
  it("deduplicates comprehensive records despite city and financing-label differences, keeping the latest version", () => {
    const rows = buildProjectCatalog([], [], [
      { id: "older", name: "同一项目", track: "AI", subtrack: "", city: "", signalType: "投融资", eventDate: "2026-09-04", status: "pending_review", summary: "较早版本", createdAt: "2026-09-04T01:00:00Z" },
      { id: "newer", name: "同一项目", track: "AI", subtrack: "Agent", city: "杭州", signalType: "funding", eventDate: "2026-09-04", status: "pending_review", summary: "信息更完整的最新版本", createdAt: "2026-09-04T03:00:00Z" },
    ]);
    expect(rows.filter((row) => row.name === "同一项目")).toHaveLength(1);
    expect(rows.find((row) => row.name === "同一项目")?.summary).toBe("信息更完整的最新版本");
  });
});
