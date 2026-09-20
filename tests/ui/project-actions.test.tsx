// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectActions, ReviewDecisionButton } from "@/components/project-actions";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("project workflow actions", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("labels unmeasured assignment profiles without claiming zero workload", () => {
    render(<ProjectActions projectId="project-1" version={1} owner={null}
      team={[
        { id: "new", name: "新成员", role: "成员", tracks: [], subtracks: [], currentLoad: 0, assignmentProfileKnown: false },
        { id: "known", name: "已有成员", role: "投资经理", tracks: ["AI"], subtracks: [], currentLoad: 2 },
      ]}
      profiles={[{ id: "dd", version: "1", label: "尽调", description: "测试", agentRef: "agent", skillRefs: [] }]} />);
    fireEvent.click(screen.getByRole("button", { name: "分配负责人" }));
    expect(screen.getByRole("checkbox", { name: "新成员 · 赛道待补充 · 负载待统计" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "已有成员 · AI · 在手 2" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /新成员.*在手 0/ })).toBeNull();
  });

  it("keeps known tracks on an unmeasured profile and the legacy empty-track presentation", () => {
    render(<ProjectActions projectId="project-1" version={1} owner={null}
      team={[
        { id: "new", name: "赛道成员", role: "成员", tracks: ["AI"], subtracks: [], currentLoad: 0, assignmentProfileKnown: false },
        { id: "legacy", name: "旧成员", role: "成员", tracks: [], subtracks: [], currentLoad: 0 },
        { id: "known", name: "已统计", role: "成员", tracks: ["AI"], subtracks: [], currentLoad: 0, assignmentProfileKnown: true },
      ]}
      profiles={[{ id: "dd", version: "1", label: "尽调", description: "测试", agentRef: "agent", skillRefs: [] }]} />);
    fireEvent.click(screen.getByRole("button", { name: "分配负责人" }));
    expect(screen.getByRole("checkbox", { name: "赛道成员 · AI · 负载待统计" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "旧成员 · · 在手 0" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "已统计 · AI · 在手 0" })).toBeTruthy();
  });

  it("offers local-only uploads with accurate processing feedback", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { projectVersion: 2, externalPolicy: "local_only" } }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ProjectActions projectId="project-1" version={1} owner={null} team={[{ id: "user-1", name: "测试成员", role: "投资经理", tracks: ["AI"], subtracks: [], currentLoad: 0 }]} profiles={[{ id: "dd", version: "1", label: "尽调", description: "测试", agentRef: "agent", skillRefs: [] }]} />);
    fireEvent.click(screen.getByRole("button", { name: "上传资料" }));
    expect(screen.queryByRole("checkbox", { name: /发送给 DeepSeek/ })).toBeNull();
    expect(screen.getByText("上传时仅在服务器本地保存和解析；项目助手会在提问并确认后读取相关资料片段。")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("项目资料"), { target: { files: [new File(["private"], "private.txt", { type: "text/plain" })] } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await screen.findByText("资料已上传，可在项目知识库向助手提问");
    expect((fetchMock.mock.calls[0][1].body as FormData).get("externalPolicy")).toBe("local_only");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("persists project assignment and reports the assignee", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { owner: "演示投资经理", version: 2 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ProjectActions projectId="project-1" version={1} owner={null} />);

    fireEvent.click(screen.getByRole("button", { name: "分配项目" }));
    await screen.findByText("已分配给演示投资经理");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/projects/project-1/assignment", expect.objectContaining({ method: "PATCH" }));
  });

  it("queues research and confirms the persisted job", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: "job-1", status: "queued" } }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ProjectActions projectId="project-1" version={1} owner={null} />);

    fireEvent.click(screen.getByRole("button", { name: "进入研究" }));
    await screen.findByText("研究任务已入队");
  });

  it("submits the review decision and shows completion", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { status: "researching", version: 2 } }), { status: 200 })));
    render(<ReviewDecisionButton projectId="project-1" version={1} requested={false} />);

    fireEvent.click(screen.getByRole("button", { name: "保留冲突并请求补证" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "已请求补证" }) as HTMLButtonElement).disabled).toBe(true));
    expect(fetch).toHaveBeenCalledWith("/api/v1/projects/project-1/evidence-request", expect.objectContaining({ method: "POST" }));
  });

  it("manually selects an exact workflow stage and refreshes the project", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { status: "researching", dealStage: "initiation", dealStageLabel: "立项", version: 6 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ProjectActions projectId="project-1" version={5} owner={null} status="dd" dealStage="dd"
      team={[{ id: "user-1", name: "测试成员", role: "投资经理", tracks: ["AI"], subtracks: [], currentLoad: 0 }]}
      profiles={[{ id: "dd", version: "1", label: "尽调", description: "测试", agentRef: "agent", skillRefs: [] }]} />);

    fireEvent.click(screen.getByRole("button", { name: "选择阶段" }));
    expect((screen.getByLabelText("当前项目阶段") as HTMLSelectElement).value).toBe("dd");
    fireEvent.change(screen.getByLabelText("当前项目阶段"), { target: { value: "initiation" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    await screen.findByText("项目阶段已更新为立项");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ expectedVersion: 5, status: "researching", dealStage: "initiation", note: "手动选择项目阶段：立项" });
    expect(refresh).toHaveBeenCalled();
  });

  it("restores a persisted evidence request as complete", () => {
    render(<ReviewDecisionButton projectId="project-1" version={2} requested />);
    expect((screen.getByRole("button", { name: "已请求补证" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

it("submits multiple responsible people and restores the saved selection", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { owner: "甲经理", owners: ["甲经理", "乙经理"], version: 2 } })));
  vi.stubGlobal("fetch", fetchMock);
  render(<ProjectActions projectId="project-1" version={1} owner="甲经理" owners={["甲经理"]}
    team={[{ id: "a", name: "甲经理", role: "成员", tracks: [], subtracks: [], currentLoad: 0 }, { id: "b", name: "乙经理", role: "成员", tracks: [], subtracks: [], currentLoad: 0 }]}
    profiles={[{ id: "dd", version: "1", label: "尽调", description: "测试", agentRef: "agent", skillRefs: [] }]} />);
  fireEvent.click(screen.getByRole("button", { name: "分配负责人" }));
  expect((screen.getByRole("checkbox", { name: /甲经理/ }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: /乙经理/ }));
  fireEvent.click(screen.getByRole("button", { name: "确认" }));
  await screen.findByText("已分配给甲经理、乙经理");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ expectedVersion: 1, assignees: ["甲经理", "乙经理"] });
  fireEvent.click(screen.getByRole("button", { name: "分配负责人" }));
  expect((screen.getByRole("checkbox", { name: /乙经理/ }) as HTMLInputElement).checked).toBe(true);
  vi.unstubAllGlobals();
});

it("allows replacing an unavailable historical owner instead of hiding an invalid selection", () => {
  render(<ProjectActions projectId="project-1" version={1} owner="离职负责人" owners={["离职负责人"]}
    team={[{ id: "a", name: "现任经理", role: "成员", tracks: [], subtracks: [], currentLoad: 0 }]}
    profiles={[{ id: "dd", version: "1", label: "尽调", description: "测试", agentRef: "agent", skillRefs: [] }]} />);
  fireEvent.click(screen.getByRole("button", { name: "分配负责人" }));
  fireEvent.click(screen.getByRole("checkbox", { name: /离职负责人/ }));
  expect((screen.getByRole("button", { name: "确认" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: /现任经理/ }));
  expect((screen.getByRole("button", { name: "确认" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  fireEvent.click(screen.getByRole("button", { name: "分配负责人" }));
  expect((screen.getByRole("checkbox", { name: /离职负责人/ }) as HTMLInputElement).checked).toBe(true);
});
it("searches responsible people by name or real department", () => {
  render(<ProjectActions projectId="project-1" version={1} owner={null}
    team={[{id:"a",name:"甲经理",role:"成员",tracks:[],subtracks:[],currentLoad:0,departmentName:"投资部"},{id:"b",name:"乙经理",role:"成员",tracks:[],subtracks:[],currentLoad:0,departmentName:"财务部"}]}
    profiles={[{id:"dd",version:"1",label:"尽调",description:"测试",agentRef:"agent",skillRefs:[]}]} />);
  fireEvent.click(screen.getByRole("button",{name:"分配负责人"}));
  fireEvent.change(screen.getByRole("searchbox",{name:"搜索项目负责人"}),{target:{value:"财务"}});
  expect(screen.getByRole("checkbox",{name:/乙经理/})).toBeTruthy();
  expect(screen.queryByRole("checkbox",{name:/甲经理/})).toBeNull();
});
