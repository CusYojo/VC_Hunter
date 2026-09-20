// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FileViewerDialog } from "@/components/file-viewer-dialog";
afterEach(() => vi.unstubAllGlobals());
it("places filename, original-file actions and truncation disclosure in a collapsible sidebar", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: { text: "文件正文", truncated: true } }) })));
  render(<FileViewerDialog name="报告.docx" kind="docx" url="/private/doc" description="事项原件" onClose={vi.fn()} />);
  await screen.findByText("文件正文");
  const dialog = screen.getByRole("dialog", { name: "报告.docx" });
  const sidebar = within(dialog).getByRole("complementary", { name: "文件信息与操作" });
  expect(within(sidebar).getByRole("heading", { name: "报告.docx" })).toBeVisible();
  expect(within(sidebar).getByRole("link", { name: "下载 报告.docx" })).toHaveAttribute("href", "/private/doc?download=1");
  expect(within(sidebar).getByText(/Word.*文字预览/)).toBeVisible();
  expect(await within(sidebar).findByText(/当前展示部分正文/)).toBeVisible();
  expect(within(dialog).getAllByRole("link", { name: /下载/ })).toHaveLength(1);
  fireEvent.click(within(dialog).getByRole("button", { name: "收起文件信息" }));
  expect(within(dialog).getByRole("button", { name: "展开文件信息" })).toHaveAttribute("aria-expanded", "false");
  expect(within(dialog).getByText("文件正文")).toBeVisible();
});
it("keeps existing original blobs intact and closes through the supplied action", async () => {
  const fetch = vi.fn(), onClose = vi.fn(); vi.stubGlobal("fetch", fetch);
  render(<FileViewerDialog name="原件.pdf" kind="pdf" url="blob:local-original" onClose={onClose} closeLabel="关闭预览"><iframe title="已有原件" src="blob:local-original" /></FileViewerDialog>);
  expect(screen.getByRole("link", { name: "下载 原件.pdf" })).toHaveAttribute("href", "blob:local-original");
  expect(screen.getByTitle("已有原件")).toHaveAttribute("src", "blob:local-original");
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

it("starts narrow screens with document information collapsed and keeps close reachable", async () => {
  vi.stubGlobal("innerWidth", 390);
  render(<FileViewerDialog name="手机原件.pdf" kind="pdf" url="blob:mobile" onClose={vi.fn()}><iframe title="手机正文" src="blob:mobile" /></FileViewerDialog>);
  expect(screen.getByRole("dialog", { name: "手机原件.pdf" })).toBeVisible();
  expect(screen.getByRole("button", { name: "展开文件信息" })).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("link", { name: "下载 手机原件.pdf" })).toBeNull();
  expect(screen.getByRole("button", { name: "关闭文件预览" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "展开文件信息" }));
  expect(screen.getByRole("link", { name: "下载 手机原件.pdf" })).toBeVisible();
});
