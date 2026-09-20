// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FundsCenter } from "@/components/operating/funds-center";
import { FinanceCenter } from "@/components/operating/finance-center";
import { AiCenter } from "@/components/operating/ai-center";
import { ResourcesCenter } from "@/components/operating/resources-center";
import { ResearchCenter } from "@/components/operating/research-center";
import { dispatchPrototype } from "@/prototype/store";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("business centers", () => {
  afterEach(() => vi.unstubAllGlobals());
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

  it("shows authentic empty fund and finance records without fixtures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: { records: [], canWrite: true, projects: [], funds: [], documents: [] } }) })));
    const { unmount } = render(<FundsCenter initialView="funds" />);
    expect(await screen.findByText("暂无基金记录")).toBeTruthy();
    expect(screen.queryByText("硬科技成长二期基金")).toBeNull();
    unmount();
    render(<FinanceCenter initialView="expenses" />);
    expect(await screen.findByText("暂无费用记录")).toBeTruthy();
    expect(screen.getByRole("button", { name: "新建费用" })).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("loads private real agent run records instead of demo tasks", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => ({ data: url.endsWith("/projects") ? { items: [] } : url.endsWith("/settings/ai") ? { activeProvider: null, providers: [] } : [] }) })));
    render(<AiCenter initialView="runs" />);
    expect(await screen.findByText("还没有历史单次任务记录。")).toBeTruthy();
    expect(screen.queryByText("核验玄芯微电子 23 份资料")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("labels API-backed research and resource summaries as real data", () => {
    render(<ResearchCenter initialView="workspace" realSummary={{ reports: 8, knowledge: 14, alerts: 3 }} />);
    render(<ResourcesCenter initialView="contacts" realSummary={{ people: 7, institutions: 12, experts: 4 }} />);

    expect(screen.getAllByText("真实数据").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("14 条知识沉淀")).toBeTruthy();
    expect(screen.getByText("12 家机构")).toBeTruthy();
  });
});
