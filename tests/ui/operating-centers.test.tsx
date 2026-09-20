// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalsCenter } from "@/components/operating/approvals-center";
import { WorkCenter } from "@/components/operating/work-center";
import { AdminCenter } from "@/components/operating/admin-center";
import { dispatchPrototype } from "@/prototype/store";

describe("interactive operating centers", () => {
  beforeEach(() => {
    localStorage.clear();
    dispatchPrototype({ type: "prototype.reset" });
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("lets a manager complete a work item and retains the visible result", () => {
    render(<WorkCenter initialView="tasks" />);

    fireEvent.click(screen.getByRole("button", { name: "完成 补齐具身机器人客户访谈" }));

    expect(screen.getByText("任务已完成")).toBeTruthy();
    expect(screen.getByText("1 项刚刚更新并已保存到本机")).toBeTruthy();
  });

  it("lets a partner inspect and approve a pending request", () => {
    dispatchPrototype({ type: "persona.select", persona: "partner" });
    render(<ApprovalsCenter initialView="inbox" />);

    fireEvent.click(screen.getByRole("button", { name: "查看 灵巧智能 Pre-A 轮 IC 决策" }));
    expect(screen.getByRole("dialog", { name: "灵巧智能 Pre-A 轮 IC 决策" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "批准申请" }));

    expect(screen.getByText("审批已通过")).toBeTruthy();
    expect(screen.getByText(/顾明远 · 已批准/)).toBeTruthy();
  });

  it("lets an administrator disable and re-enable a workflow", () => {
    dispatchPrototype({ type: "persona.select", persona: "super_admin" });
    render(<AdminCenter initialView="workflows" />);

    const toggle = screen.getByRole("button", { name: "停用 投资项目分级审批" });
    fireEvent.click(toggle);

    expect(screen.getByRole("button", { name: "启用 投资项目分级审批" })).toBeTruthy();
    expect(screen.getByText("工作流已停用")).toBeTruthy();
  });
});
