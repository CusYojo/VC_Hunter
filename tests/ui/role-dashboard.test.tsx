// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { dateKeyInShanghai, RoleDashboard } from "@/components/operating/role-dashboard";
import { dispatchPrototype } from "@/prototype/store";

const projects = [
  {
    id: "project-embodied-ai",
    name: "灵巧智能",
    track: "具身智能",
    status: "dd",
    latestProgress: "客户访谈已完成，财务尽调待启动。",
    latestAt: "2026-09-03T08:00:00.000Z",
    latestComment: { author: "外部产业顾问", authorRole: "外部顾问", source: "external" as const, body: "请把量产良率列为交割条件。", createdAt: "2026-09-03T09:00:00.000Z" },
  },
];

const TODAY = dateKeyInShanghai(new Date().toISOString());

describe("role dashboard", () => {
  beforeEach(() => dispatchPrototype({ type: "prototype.reset" }));

  it("keeps the personal workbench focused and removes the Agent review panel", () => {
    render(<RoleDashboard userName="示例经理" todayDate={TODAY} projects={projects} />);

    expect(screen.getByRole("heading", { name: "今日工作台" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "我负责的项目" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "今日待办" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "今日日程" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "最新项目批注" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Agent 新项目待复核" })).toBeNull();
    expect(screen.queryByRole("region", { name: "关键指标" })).toBeNull();
  });

  it("places today's schedule below the latest project comments", () => {
    render(<RoleDashboard userName="示例经理" todayDate={TODAY} projects={projects} />);
    const comments = screen.getByRole("region", { name: "最新项目批注" });
    const schedule = screen.getByRole("region", { name: "今日日程" });
    expect(comments.compareDocumentPosition(schedule) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("places the server-backed schedule workspace below the latest project comments", () => {
    render(<RoleDashboard userName="示例经理" todayDate={TODAY} projects={projects} activity={<section aria-label="服务器日程表">日程表</section>} />);
    const comments = screen.getByRole("region", { name: "最新项目批注" });
    const schedule = screen.getByRole("region", { name: "服务器日程表" });
    expect(comments.compareDocumentPosition(schedule) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("puts project progress and outside opinions directly on the project card", () => {
    render(<RoleDashboard userName="示例经理" todayDate={TODAY} projects={projects} />);

    const card = screen.getByRole("article", { name: "灵巧智能项目摘要" });
    expect(within(card).getByText("客户访谈已完成，财务尽调待启动。")).toBeTruthy();
    expect(within(card).getByText("外部产业顾问：请把量产良率列为交割条件。")).toBeTruthy();
    expect(within(card).getByRole("link", { name: "打开灵巧智能" }).getAttribute("href")).toBe("/projects/project-embodied-ai");
  });

  it("shows only my open tasks and today's schedule with people, topic and project", () => {
    render(<RoleDashboard userName="示例经理" todayDate={TODAY} projects={projects} />);

    const tasks = screen.getByRole("region", { name: "今日待办" });
    expect(within(tasks).getByText("补齐具身机器人客户访谈")).toBeTruthy();
    expect(within(tasks).queryByText("复核航天项目收入模型")).toBeNull();

    const schedule = screen.getByRole("region", { name: "今日日程" });
    expect(within(schedule).getByText("灵巧智能创始人访谈")).toBeTruthy();
    expect(within(schedule).getByText(/示例经理、顾明远、周宁/)).toBeTruthy();
    expect(within(schedule).getByText(/关联项目：灵巧智能/)).toBeTruthy();
    expect(within(schedule).getByText("先进制造周度例会")).toBeTruthy();
  });

  it("lets me accept work, decline a meeting and request a schedule change", () => {
    render(<RoleDashboard userName="示例经理" todayDate={TODAY} projects={projects} />);

    fireEvent.click(screen.getByRole("button", { name: "接受待办 补齐具身机器人客户访谈" }));
    expect(screen.getByRole("status").textContent).toContain("已接受待办：补齐具身机器人客户访谈");
    expect(screen.queryByRole("button", { name: "接受待办 补齐具身机器人客户访谈" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "拒绝会议 灵巧智能创始人访谈" }));
    expect(screen.getByRole("status").textContent).toContain("已拒绝会议：灵巧智能创始人访谈");

    fireEvent.click(screen.getByRole("button", { name: "建议改期会议 玄芯微电子法务专项" }));
    expect(screen.getByRole("status").textContent).toContain("已建议改期：玄芯微电子法务专项");
    expect(window.localStorage.getItem("vc-hunter:prototype:v1")).toContain("change_requested");
  });

  it("does not show Agent recommendations on the workbench", () => {
    render(<RoleDashboard userName="示例经理" todayDate={TODAY} projects={projects} />);

    expect(screen.queryByText("星河芯片")).toBeNull();
  });

  it("keeps the selected demo role visible without changing the information hierarchy", () => {
    dispatchPrototype({ type: "persona.select", persona: "partner" });
    render(<RoleDashboard userName="顾明远" todayDate={TODAY} projects={projects} />);

    expect(screen.getByText("Partner / 合伙人视图")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "今日工作台" })).toBeTruthy();
  });

  it("uses Shanghai day boundaries for UTC timestamps", () => {
    expect(dateKeyInShanghai("2026-09-03T15:59:59.000Z")).toBe("2026-09-03");
    expect(dateKeyInShanghai("2026-09-03T16:00:00.000Z")).toBe("2026-09-04");
  });
});
