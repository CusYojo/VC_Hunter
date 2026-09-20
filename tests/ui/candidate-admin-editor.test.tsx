// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CandidateAdminEditor } from "@/components/candidate-admin-editor";
import type { CandidateView } from "@/workbench/candidate-details";
const candidate: CandidateView = { id:"candidate",companyName:"原始项目",track:"AI",summary:"原始摘要",investorNames:["原机构"],signalType:"funding",confidence:0.8,status:"pending_review",version:3,lead:{title:"来源",url:"https://example.test",publishedAt:null},projectId:null,createdAt:"2026-09-04" };
afterEach(() => vi.unstubAllGlobals());
it("submits the current version and edited content, then delivers the saved candidate", async () => {
  const onUpdated = vi.fn(); const saved={...candidate,companyName:"修改项目",version:4};
  const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({data:saved})));vi.stubGlobal("fetch",fetchMock);
  render(<CandidateAdminEditor candidate={candidate} onUpdated={onUpdated} />);
  fireEvent.click(screen.getByRole("button",{name:"编辑项目信息"}));
  fireEvent.change(screen.getByLabelText("项目名称"),{target:{value:"修改项目"}});
  fireEvent.change(screen.getByLabelText("投资方"),{target:{value:"甲机构、乙机构"}});
  fireEvent.click(screen.getByRole("button",{name:"保存项目内容"}));
  await waitFor(()=>expect(onUpdated).toHaveBeenCalledWith(saved));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({expectedVersion:3,companyName:"修改项目",investorNames:["甲机构","乙机构"]});
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("keeps user edits after failure and reuses the same request key for a retry", async () => {
  const fetchMock=vi.fn().mockRejectedValueOnce(new TypeError("网络中断")).mockResolvedValueOnce(new Response(JSON.stringify({data:{...candidate,version:4}})));vi.stubGlobal("fetch",fetchMock);
  render(<CandidateAdminEditor candidate={candidate} onUpdated={()=>{}} />);
  fireEvent.click(screen.getByRole("button",{name:"编辑项目信息"}));
  fireEvent.click(screen.getByRole("button",{name:"保存项目内容"}));await screen.findByRole("alert");
  expect((screen.getByLabelText("项目摘要") as HTMLTextAreaElement).value).toBe("原始摘要");
  fireEvent.click(screen.getByRole("button",{name:"保存项目内容"}));await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(fetchMock.mock.calls[1][1].headers["idempotency-key"]).toBe(fetchMock.mock.calls[0][1].headers["idempotency-key"]);
});
it("directs admitted candidates to the formal project instead of changing archived discovery history", () => {
  render(<CandidateAdminEditor candidate={{...candidate,status:"promoted",projectId:"formal"}} onUpdated={()=>{}} />);
  expect(screen.getByRole("link",{name:"在正式项目中编辑"}).getAttribute("href")).toBe("/projects/formal");
  expect(screen.queryByRole("button",{name:"编辑项目信息"})).toBeNull();
});
