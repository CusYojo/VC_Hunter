// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AISettings } from "@/components/ai/ai-settings";
const empty = { activeProvider: null, providers: ["openai", "claude", "kimi", "deepseek", "glm", "qwen"].map(provider => ({ provider, configured: false, model: "", updatedAt: null })) };
afterEach(() => vi.unstubAllGlobals());
it("offers GPT 5.6 tiers directly and saves the selected exact model", async () => {
  const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => ({ ok: true, json: async () => ({ data: options?.method ? { ...empty, activeProvider: "openai", providers: empty.providers.map(row => row.provider === "openai" ? { ...row, configured: true, model: "gpt-5.6-terra" } : row) } : empty }) }));
  vi.stubGlobal("fetch", fetchMock); render(<AISettings />);
  expect(await screen.findByLabelText("模型 ID")).toHaveValue("gpt-5.6-sol");
  const picker = screen.getByLabelText("常用模型");
  expect([...picker.querySelectorAll("option")].map(option => option.value)).toEqual(expect.arrayContaining(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]));
  fireEvent.change(picker, { target: { value: "gpt-5.6-terra" } });
  expect(screen.getByLabelText("模型 ID")).toHaveValue("gpt-5.6-terra");
  fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "fixture-only-key" } });
  fireEvent.click(screen.getByRole("button", { name: "保存并使用" }));
  await screen.findByText("已保存为当前账号的默认模型。");
  const request = fetchMock.mock.calls.find(([, options]) => options?.method === "PUT")!;
  expect(JSON.parse(request[1]!.body as string).model).toBe("gpt-5.6-terra");
});
it("preserves an existing saved model and permits provider-specific custom IDs", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: { ...empty, activeProvider: "openai", providers: empty.providers.map(row => row.provider === "openai" ? { ...row, configured: true, model: "gpt-4.1" } : row) } }) })));
  render(<AISettings />);
  expect(await screen.findByLabelText("模型 ID")).toHaveValue("gpt-4.1");
  expect(screen.getByLabelText("常用模型")).toHaveValue("gpt-4.1");
  fireEvent.change(screen.getByLabelText("模型 ID"), { target: { value: "account-specific-model" } });
  expect(screen.getByLabelText("常用模型")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("服务商"), { target: { value: "deepseek" } });
  expect(screen.getByLabelText("模型 ID")).toHaveValue("deepseek-v4-flash");
  fireEvent.change(screen.getByLabelText("服务商"), { target: { value: "openai" } });
  expect(screen.getByLabelText("模型 ID")).toHaveValue("gpt-4.1");
});
