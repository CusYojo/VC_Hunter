// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CatalogCandidateActions } from "@/components/catalog-candidate-actions";
import type { CandidateView } from "@/workbench/candidate-details";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const candidate: CandidateView = { id: "c", companyName: "历史芯片", track: "半导体", investorNames: [], signalType: "investment", summary: "线索", confidence: 0.9, status: "pending_review", version: 3, lead: { title: "来源", url: "https://example.com", publishedAt: null }, projectId: null, createdAt: "2026-01-01" };
const props = { candidate, team: [{ id: "a", name: "甲" }], currentUser: "甲", canAdmin: true, canReview: true };
it("preserves historical candidate intake and refreshes the catalog only after confirmation", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { ...candidate, status: "promoted", projectId: "p", version: 4 } }) });vi.stubGlobal("fetch", fetcher);
  render(<CatalogCandidateActions {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "入库" }));
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: "我感兴趣，加入项目" }));
  fireEvent.click(screen.getByRole("button", { name: "确认入库" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ decision: "promote", expectedVersion: 3, assignee: "甲" });
  expect(screen.queryByRole("button", { name: "入库" })).toBeNull();
});
it("keeps failed defer actions retryable with the same idempotency key", async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error("断网")).mockResolvedValueOnce({ ok: true, json: async () => ({ data: { ...candidate, status: "dismissed", version: 4 } }) });vi.stubGlobal("fetch", fetcher);
  render(<CatalogCandidateActions {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "暂不跟进" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("断网");
  fireEvent.click(screen.getByRole("button", { name: "暂不跟进" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(fetcher.mock.calls[0][1].headers["idempotency-key"]).toEqual(fetcher.mock.calls[1][1].headers["idempotency-key"]);
  expect(screen.queryByRole("button", { name: "入库" })).toBeNull();
});
it("keeps archived candidates read only and administrator editing restricted", () => {
  const view = render(<CatalogCandidateActions {...props} candidate={{ ...candidate, archivedAt: "2026-09-01" }} />);
  expect(screen.queryByRole("button")).toBeNull();
  view.rerender(<CatalogCandidateActions {...props} canAdmin={false} />);
  expect(screen.queryByRole("button", { name: "编辑项目信息" })).toBeNull();
  view.rerender(<CatalogCandidateActions {...props} />);
  expect(screen.getByRole("button", { name: "编辑项目信息" })).toBeVisible();
});

it("keeps intake server errors in the dialog and supports cancel without changing the catalog", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: { message: "资料已更新，请刷新" } }) });vi.stubGlobal("fetch", fetcher);
  render(<CatalogCandidateActions {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "入库" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "我感兴趣，加入项目" }));
  fireEvent.click(screen.getByRole("button", { name: "确认入库" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("资料已更新，请刷新");
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("refreshes the catalog after an administrator edits the original candidate", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { ...candidate, companyName: "已核验芯片", version: 4 } }) });vi.stubGlobal("fetch", fetcher);
  render(<CatalogCandidateActions {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "编辑项目信息" }));
  fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "已核验芯片" } });
  fireEvent.click(screen.getByRole("button", { name: "保存项目内容" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "入库" }));
  expect(screen.getByRole("dialog", { name: "入库 · 已核验芯片" })).toBeVisible();
});


it("hides review actions by default while keeping administrator editing independently authorized", () => {
  const view = render(<CatalogCandidateActions candidate={candidate} team={props.team} currentUser="甲" canAdmin={false} />);
  expect(screen.queryByRole("button", { name: "入库" })).toBeNull();
  expect(screen.queryByRole("button", { name: "暂不跟进" })).toBeNull();
  view.rerender(<CatalogCandidateActions {...props} canReview={false} />);
  expect(screen.queryByRole("button", { name: "入库" })).toBeNull();
  expect(screen.queryByRole("button", { name: "暂不跟进" })).toBeNull();
  expect(screen.getByRole("button", { name: "编辑项目信息" })).toBeVisible();
});
