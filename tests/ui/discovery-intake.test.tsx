// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { DiscoveryWorkbench } from "@/components/discovery-workbench";
import type { CandidateView } from "@/workbench/candidate-details";

const candidate: CandidateView = { id: "candidate-1", companyName: "星河芯片", track: "半导体", investorNames: ["投资机构"], signalType: "investment", summary: "芯片项目融资线索", confidence: 0.9, status: "pending_review", version: 1, lead: { title: "来源", url: "https://example.com", publishedAt: "2026-09-04", publicationVerifiedAt: "2026-09-04T00:00:00Z" }, projectId: null, createdAt: "2026-09-04" };
const props = { jobs: [], candidates: [candidate], team: [{ id: "a", name: "王经理" }, { id: "b", name: "林经理" }], currentUser: "王经理" };
const promoted = () => new Response(JSON.stringify({ data: { id: candidate.id, status: "promoted", version: 2, projectId: "project-1" } }));
const expandCandidate = () => fireEvent.click(screen.getByRole("button", { name: "查看项目详情" }));
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-04T04:00:00Z")); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("keeps review actions in the expanded details, with assignment deferred until intake is opened", () => {
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  render(<DiscoveryWorkbench {...props} />);
  const card = within(screen.getByRole("article"));
  expect(card.queryByRole("button", { name: "暂不跟进" })).toBeNull();
  expect(card.queryByRole("button", { name: "入库" })).toBeNull();
  expandCandidate();
  expect(card.getByRole("button", { name: "暂不跟进" })).toBeTruthy();
  expect(card.getByRole("button", { name: "入库" })).toBeTruthy();
  expect(card.queryByRole("combobox")).toBeNull();
  expect(card.queryByText("我感兴趣，加入项目")).toBeNull();
  fireEvent.click(card.getByRole("button", { name: "入库" }));
  const dialog = within(screen.getByRole("dialog", { name: "入库 · 星河芯片" }));
  expect(dialog.getByRole("checkbox", { name: "分发给同事" })).toBeTruthy();
  expect(dialog.getByRole("checkbox", { name: "我感兴趣，加入项目" })).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(dialog.getByRole("button", { name: "取消" }));
  expect(fetchMock).not.toHaveBeenCalled();
});

it("searches intake assignees by real department metadata", () => {
  vi.stubGlobal("fetch", vi.fn());
  render(<DiscoveryWorkbench {...props} team={[{ id:"a",name:"王经理",departmentName:"投资部" },{ id:"b",name:"林经理",departmentName:"财务部" }]} />);
  expandCandidate();
  fireEvent.click(screen.getByRole("button", { name:"入库" }));
  fireEvent.click(screen.getByRole("checkbox", { name:"分发给同事" }));
  fireEvent.change(screen.getByRole("searchbox", { name:"搜索入库负责人" }), { target:{ value:"财务" } });
  expect(screen.getByRole("checkbox", { name:/林经理/ })).toBeTruthy();
  expect(screen.queryByRole("checkbox", { name:/王经理/ })).toBeNull();
});

it("confirms assignment atomically and keeps the admitted project on its discovery card", async () => {
  const fetchMock = vi.fn().mockResolvedValue(promoted()); vi.stubGlobal("fetch", fetchMock);
  render(<DiscoveryWorkbench {...props} />);
  expandCandidate();
  fireEvent.click(screen.getByRole("button", { name: "入库" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "分发给同事" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "林经理" }));
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认入库" }));
  await waitFor(() => expect(screen.getByText("已入库", { exact: true })).toBeTruthy());
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ decision: "promote", expectedVersion: 1, assignee: "林经理" });
  expect(screen.getByRole("heading", { name: "星河芯片" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "打开项目" }).getAttribute("href")).toBe("/projects/project-1");
  expect(screen.queryByRole("button", { name: "入库" })).toBeNull();
});

it("assigns the current user only after choosing interest and confirming", async () => {
  const fetchMock = vi.fn().mockResolvedValue(promoted()); vi.stubGlobal("fetch", fetchMock);
  render(<DiscoveryWorkbench {...props} />);
  expandCandidate();
  fireEvent.click(screen.getByRole("button", { name: "入库" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "我感兴趣，加入项目" }));
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认入库" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).assignee).toBe("王经理");
});

it("keeps failures inside the dialog without showing an admitted badge", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "负责人不可用" } }), { status: 400 })); vi.stubGlobal("fetch", fetchMock);
  render(<DiscoveryWorkbench {...props} />);
  expandCandidate();
  fireEvent.click(screen.getByRole("button", { name: "入库" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "我感兴趣，加入项目" }));
  fireEvent.click(screen.getByRole("button", { name: "确认入库" }));
  await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toContain("负责人不可用"));
  expect(screen.queryByText("已入库", { exact: true })).toBeNull();
});

it("renders promoted items from server data without offering repeat intake", () => {
  render(<DiscoveryWorkbench {...props} candidates={[{ ...candidate, status: "promoted", version: 2, projectId: "project-1" }]} />);
  expect(screen.getByRole("heading", { name: "星河芯片" })).toBeTruthy();
  expect(screen.getByText("已入库", { exact: true })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "入库" })).toBeNull();
  expandCandidate();
  expect(screen.getByRole("link", { name: "打开项目" }).getAttribute("href")).toBe("/projects/project-1");
  expect(screen.queryByRole("button", { name: "入库" })).toBeNull();
});

it("combines colleague distribution and joining the same project in one confirmation", async () => {
  const fetchMock = vi.fn().mockResolvedValue(promoted()); vi.stubGlobal("fetch", fetchMock);
  render(<DiscoveryWorkbench {...props} />);
  expandCandidate();
  fireEvent.click(screen.getByRole("button", { name: "入库" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "分发给同事" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "林经理" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "我感兴趣，加入项目" }));
  fireEvent.click(screen.getByRole("button", { name: "确认入库" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ assignees: ["林经理", "王经理"] });
  await screen.findByText("项目已入库，负责人：林经理、王经理");
});


it("moves a deferred candidate out of the daily queue with a clear archive destination", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: candidate.id, status: "dismissed", version: 2, projectId: null } })));vi.stubGlobal("fetch", fetchMock);
  render(<DiscoveryWorkbench {...props} />);
  expandCandidate();
  fireEvent.click(screen.getByRole("button", { name: "暂不跟进" }));
  await waitFor(() => expect(screen.queryByRole("heading", { name: candidate.companyName })).toBeNull());
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ decision: "reject", expectedVersion: 1 });
  expect(screen.getByText("可在更多功能 → 全部项目中查找，原始资料和处理记录均已保留。")).toBeTruthy();
});
