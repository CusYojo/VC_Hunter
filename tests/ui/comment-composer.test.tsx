// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ActivityDiscussion } from "@/components/activity-discussion";
afterEach(() => vi.unstubAllGlobals());
it("places a text-first reply beneath its target and inserts only an eligible person's mention", async () => {
  const comment = { id: "c", sequence: 1, activityId: "a", parentId: null, authorId: "m", body: "请看原文", createdAt: "2026-09-04", documents: [] };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: { items: [comment], hasMore: false } }) })));
  render(<ActivityDiscussion activityId="a" memberName={() => "小林"} projectOptions={[]} members={[{ id: "m", name: "小林" }]} />);
  fireEvent.click(screen.getByRole("button", { name: "审核 / 批注" }));await screen.findByText("请看原文");
  fireEvent.click(screen.getByRole("button", { name: "回复 小林的批注" }));
  const row = screen.getByText("请看原文", { exact: true }).closest("li")!;
  expect(within(row).getByLabelText("批注内容")).toBeVisible();expect(within(row).getByRole("button", { name: "@知识库" })).toBeVisible();
  fireEvent.click(within(row).getByRole("button", { name: "@人员" }));fireEvent.click(within(row).getByRole("group", { name: "可提醒的人员" }).querySelector("button")!);
  expect(within(row).getByLabelText("批注内容")).toHaveValue("@小林 ");
  fireEvent.change(within(row).getByLabelText("附上文件"), { target: { files: [new File(["photo"], "现场.png", { type: "image/png" })] } });
  expect(within(row).getByLabelText("已选附件")).toHaveTextContent("现场.png");expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(within(row).getByRole("button", { name: "取消回复" }));expect(within(row).queryByLabelText("批注内容")).toBeNull();expect(screen.getByLabelText("批注内容")).toHaveValue("@小林 ");
});

it("searches mentionable people by name or department", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: { items: [], hasMore: false } }) })));
  render(<ActivityDiscussion activityId="a" memberName={id => id} projectOptions={[]} members={[{ id:"a",name:"甲经理",departmentName:"投资部" },{ id:"b",name:"乙经理",departmentName:"财务部" }]} />);
  fireEvent.click(screen.getByRole("button", { name:"审核 / 批注" }));
  await screen.findByText("暂无批注，可以发表第一条意见。");
  fireEvent.click(screen.getByRole("button", { name:"@人员" }));
  fireEvent.change(screen.getByRole("searchbox", { name:"搜索提醒人员" }), { target:{ value:"财务" } });
  expect(screen.getByRole("button", { name:"乙经理" })).toBeVisible();
  expect(screen.queryByRole("button", { name:"甲经理" })).toBeNull();
});
