// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectAdminEditor } from "@/components/project-admin-editor";
const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("creates an administrator project through the real API contract then opens its workspace", async () => {
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ data: { id: "created-project", version: 1 } }) }));
  vi.stubGlobal("fetch", fetcher); render(<ProjectAdminEditor />);
  fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
  fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "新材料项目" } });
  fireEvent.change(screen.getByLabelText("赛道"), { target: { value: "新材料" } });
  fireEvent.change(screen.getByLabelText("项目简介"), { target: { value: "新材料样机已完成" } });
  fireEvent.click(screen.getByRole("button", { name: "保存项目" }));
  await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/projects/created-project"));
  const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/v1/projects"); expect(options.method).toBe("POST");
  expect(JSON.parse(String(options.body))).toMatchObject({ name: "新材料项目", track: "新材料", executiveSummary: "新材料样机已完成" });
});
it("retains the edit draft and idempotency key after an uncertain save", async () => {
  const fetcher = vi.fn(async () => ({ ok: false, json: async () => ({ error: { message: "暂未保存，请重试" } }) }));
  vi.stubGlobal("fetch", fetcher); render(<ProjectAdminEditor />);
  fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
  fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "待保存项目" } });
  fireEvent.click(screen.getByRole("button", { name: "保存项目" }));
  await screen.findByRole("alert");
  expect((screen.getByLabelText("项目名称") as HTMLInputElement).value).toBe("待保存项目");
  fireEvent.click(screen.getByRole("button", { name: "保存项目" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  const first = fetcher.mock.calls[0] as unknown as [string, RequestInit], second = fetcher.mock.calls[1] as unknown as [string, RequestInit];
  expect((first[1].headers as Record<string, string>)["idempotency-key"]).toBe((second[1].headers as Record<string, string>)["idempotency-key"]);
});
