// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProjectsCenter } from "@/components/operating/projects-center";

const projects = [
  { id: "p1", name: "灵巧智能", legalName: "杭州灵巧智能科技有限公司", track: "具身智能", subtrack: "灵巧手", status: "dd", owner: "示例经理", urgencyScore: 88, qualityScore: 84, evidenceAuthority: "A", riskFlags: ["客户集中"], latestProgress: "客户访谈已完成，等待财务尽调", latestAt: "2026-09-03" },
  { id: "p2", name: "玄芯微电子", legalName: "玄芯微电子有限公司", track: "半导体", subtrack: "设备", status: "ic", owner: "周宁", urgencyScore: 76, qualityScore: 91, evidenceAuthority: "B", riskFlags: [], latestProgress: "投决材料已提交", latestAt: "2026-09-02" },
];

describe("ProjectsCenter", () => {
  it("opens project management with the current user's projects first", () => {
    render(<ProjectsCenter view="manage" projects={projects} allProjects={projects} pendingCandidates={3} currentUser="示例经理" filters={{ query: "", track: "all", owner: "all" }} />);

    expect(screen.getByRole("heading", { name: "我负责的项目" })).toBeTruthy();
    expect(screen.getByText("灵巧智能")).toBeTruthy();
    expect(screen.getByText("客户访谈已完成，等待财务尽调")).toBeTruthy();
    expect(screen.getByRole("link", { name: /查看灵巧智能项目/ }).getAttribute("href")).toBe("/projects/p1");
  });

  it("keeps only discovery and management as top-level modules", () => {
    render(<ProjectsCenter view="manage" projects={projects} allProjects={projects} pendingCandidates={3} currentUser="示例经理" filters={{ query: "", track: "all", owner: "all" }} />);

    expect(screen.getByRole("link", { name: "新项目发现" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "项目管理" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Pipeline" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Portfolio" })).toBeNull();
  });

  it("keeps project discovery inside the projects center", () => {
    render(<ProjectsCenter view="discovery" projects={projects} allProjects={projects} pendingCandidates={3} currentUser="示例经理" filters={{ query: "", track: "all", owner: "all" }} discoveryWorkspace={<div>真实发现工作台</div>} />);

    expect(screen.getByRole("heading", { name: "今日新项目" })).toBeTruthy();
    expect(screen.getByText(/每日自动搜索/)).toBeTruthy();
    expect(screen.getByText("真实发现工作台")).toBeTruthy();
  });
});


it("moves temporarily passed projects out of day-to-day project management", () => {
  const paused = { ...projects[0], id: "paused", name: "暂缓项目", status: "pass" };
  render(<ProjectsCenter view="manage" projects={[paused]} allProjects={[paused]} pendingCandidates={0} currentUser="示例经理" filters={{ query: "", track: "all", owner: "all" }} />);
  expect(screen.queryByText("暂缓项目")).toBeNull();
});
