// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AISettings } from "@/components/ai/ai-settings";

afterEach(() => vi.unstubAllGlobals());
const empty = { activeProvider: null, providers: ["openai", "claude", "kimi", "deepseek", "glm", "qwen"].map((provider) => ({ provider, configured: false, model: "", updatedAt: null })) };

it("saves a personal provider and clears the secret from the form after success", async () => {
  const mock = vi.fn(async (_url: string, options?: RequestInit) => ({ ok: true, json: async () => ({ data: options?.method === "PUT" ? { ...empty, activeProvider: "openai", providers: empty.providers.map((item) => item.provider === "openai" ? { ...item, configured: true, model: "my-model" } : item) } : empty }) }));
  vi.stubGlobal("fetch", mock); render(<AISettings />);
  await screen.findByLabelText("API Key");
  fireEvent.change(screen.getByLabelText("模型 ID"), { target: { value: "my-model" } });
  fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "private-test-key" } });
  fireEvent.click(screen.getByRole("button", { name: "保存并使用" }));
  await screen.findByText("已保存为当前账号的默认模型。");
  expect(screen.getByLabelText("API Key")).toHaveValue("");
  const body = JSON.parse(mock.mock.calls.find(([, options]) => options?.method === "PUT")![1]!.body as string);
  expect(body).toEqual({ provider: "openai", model: "my-model", apiKey: "private-test-key", activate: true });
  expect(document.body.textContent).not.toContain("private-test-key");
});

it("lets users choose all six providers and never carries a typed key to another provider", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: empty }) })));
  render(<AISettings />); await screen.findByLabelText("API Key");
  expect(screen.getByLabelText("服务商").querySelectorAll("option")).toHaveLength(6);
  fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "first-provider-key" } });
  fireEvent.change(screen.getByLabelText("服务商"), { target: { value: "claude" } });
  expect(screen.getByLabelText("API Key")).toHaveValue("");
});

it("preserves input on failure and tests only the saved provider configuration", async () => {
  const mock = vi.fn(async (_url: string, options?: RequestInit) => ({ ok: !options?.method, json: async () => options?.method ? { error: { message: "保存未完成" } } : { data: empty } }));
  vi.stubGlobal("fetch", mock); render(<AISettings />); await screen.findByLabelText("API Key");
  expect(screen.getByRole("button", { name: "测试连接" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "retry-key" } });
  fireEvent.click(screen.getByRole("button", { name: "保存并使用" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("API Key")).toHaveValue("retry-key");
  await waitFor(() => expect(screen.getByRole("button", { name: "保存并使用" })).not.toBeDisabled());
});
