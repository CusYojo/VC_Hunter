// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { DiscoveryWorkbench } from "@/components/discovery-workbench";

describe("DiscoveryWorkbench", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-04T04:00:00Z")); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("creates a search and promotes a candidate through explicit human confirmation", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "job-1", status: "queued" } }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "candidate-1", status: "promoted", version: 2, projectId: "project-1" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<DiscoveryWorkbench jobs={[]} candidates={[{ id: "candidate-1", companyName: "星河芯片", track: "半导体", investorNames: ["红杉中国"], signalType: "investment", summary: "红杉中国投资星河芯片。", confidence: 0.9, status: "pending_review", version: 1, lead: { title: "新融资", url: "https://example.com", publishedAt: "2026-09-04", publicationVerifiedAt: "2026-09-04T00:00:00Z" }, projectId: null, createdAt: "2026-09-04" }]} />);

    fireEvent.change(screen.getByLabelText("搜索主题"), { target: { value: "国内头部机构 半导体 新投资" } });
    fireEvent.click(screen.getByRole("button", { name: "让 AI 搜索" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/discovery/jobs", expect.objectContaining({ method: "POST" })));

    fireEvent.click(screen.getByRole("button", { name: "查看项目详情" }));
    fireEvent.click(screen.getByRole("button", { name: "入库" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "确认入库" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/candidates/candidate-1/review", expect.objectContaining({ method: "PATCH" })));
    expect(screen.getByText("候选已正式入库")).toBeTruthy();
  });

  it("shows the requested fields and really extracts an uploaded file for confirmation", async () => {
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({data:{text:"原始资料正文"}}))));
    render(<DiscoveryWorkbench jobs={[]} candidates={[{ id: "candidate-1", companyName: "星河芯片", track: "半导体", investorNames: ["红杉中国"], signalType: "investment", summary: "红杉中国投资星河芯片。", confidence: 0.9, status: "pending_review", version: 1, lead: { title: "新融资", url: "https://example.com", publishedAt: "2026-09-04", publicationVerifiedAt: "2026-09-04T00:00:00Z" }, projectId: null, createdAt: "2026-09-04" }]} />);

    expect(screen.getByText("融资轮次")).toBeTruthy();
    expect(screen.getByText("最新融资日期")).toBeTruthy();
    expect(screen.getByText("融资金额")).toBeTruthy();
    expect(screen.getByText("投资方")).toBeTruthy();
    expect(screen.getByText("红杉中国")).toBeTruthy();
    const upload = screen.getByLabelText("人工上传项目线索");
    expect(upload).toBeTruthy();
    fireEvent.change(upload, { target: { files: [new File(["deck"], "星河芯片-BP.pdf", { type: "application/pdf" })] } });
    expect(await screen.findByDisplayValue("原始资料正文")).toBeTruthy();
    expect(screen.getByRole("button",{name:"确认线索并保存"})).toBeTruthy();
    expect(screen.queryByText("undefined")).toBeNull();
  });

  it("turns an original project summary into a scannable investment brief", () => {
    render(<DiscoveryWorkbench jobs={[]} candidates={[{ id: "candidate-brief", companyName: "星河芯片", track: "半导体", investorNames: ["红杉中国"], signalType: "investment", summary: "公司开发端侧推理芯片。团队已完成首轮客户验证。后续需要核验量产良率。第四句话不应出现在卡片速览中。", confidence: 0.9, status: "pending_review", version: 1, round: "A轮", amountText: "2亿元人民币", lead: { title: "新融资", url: "https://example.com", publishedAt: "2026-09-04", publicationVerifiedAt: "2026-09-04T00:00:00Z" }, projectId: null, createdAt: "2026-09-04" }]} />);

    const brief = screen.getByRole("region", { name: "星河芯片投资速览" });
    expect(brief).toHaveTextContent("公司开发端侧推理芯片。");
    expect(brief).not.toHaveTextContent("团队已完成首轮客户验证");
    expect(brief).not.toHaveTextContent("第四句话");
    expect(brief).toHaveTextContent("行业分类");
    expect(brief).toHaveTextContent("半导体");
    expect(brief).toHaveTextContent("最新融资日期");
    expect(brief).toHaveTextContent("融资金额");
    expect(brief).toHaveTextContent("核心团队背景");
    expect(brief).toHaveTextContent("投资方");
    expect(brief).toHaveTextContent("红杉中国");
  });
});
