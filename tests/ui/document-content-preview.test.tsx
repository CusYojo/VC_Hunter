// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DocumentContentPreview } from "@/components/document-content-preview";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("opens PDFs through a typed blob and releases it when the document closes", async () => {
  const create = vi.fn<(blob: Blob) => string>(() => "blob:private-document");
  const revoke = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob(["%PDF-1.7"]) })));
  const view = render(<DocumentContentPreview url="/private/pdf" name="资料.pdf" kind="pdf" />);
  const iframe = await screen.findByTitle("资料.pdf 预览");
  expect(iframe.getAttribute("src")).toBe("blob:private-document#toolbar=1&navpanes=0&view=FitH");
  expect(screen.getByRole("link", { name: "打开原文件" }).getAttribute("href")).toBe("blob:private-document");
  expect(screen.getByRole("link", { name: "下载原文件" }).getAttribute("download")).toBe("资料.pdf");
  expect(create.mock.calls[0][0]).toHaveProperty("type", "application/pdf");
  view.unmount(); expect(revoke).toHaveBeenCalledWith("blob:private-document");
});

it("explains Word formatting and truncation while showing only escaped text", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: { text: "<img src=x onerror=alert(1)>", truncated: true } }) })));
  render(<DocumentContentPreview url="/private/docx" name="资料.docx" kind="docx" />);
  expect(await screen.findByText("<img src=x onerror=alert(1)>")).toBeTruthy();
  expect(screen.getByText(/完整排版/)).toBeTruthy();
  expect(screen.getByText(/当前展示部分正文/)).toBeTruthy();
  expect(document.querySelector("img")).toBeNull();
});

it("shows a download fallback for an unavailable preview", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
  render(<DocumentContentPreview url="/private/missing" name="资料.txt" kind="text" />);
  expect((await screen.findByRole("alert")).textContent).toContain("下载原文件");
});

it("does not create a PDF blob after the panel closes during loading", async () => {
  let complete!: (blob: Blob) => void;
  const create = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: vi.fn() });
  const fetchMock = vi.fn(async () => ({ ok: true, blob: () => new Promise<Blob>((resolve) => { complete = resolve; }) }));
  vi.stubGlobal("fetch", fetchMock);
  const view = render(<DocumentContentPreview url="/private/pdf" name="资料.pdf" kind="pdf" />);
  await waitFor(() => expect(complete).toBeTypeOf("function"));
  view.unmount(); complete(new Blob(["%PDF-1.7"]));
  await Promise.resolve(); expect(create).not.toHaveBeenCalled();
});

it("keeps an empty extraction distinguishable from a loading state", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: { text: "" } }) })));
  render(<DocumentContentPreview url="/private/empty" name="资料.md" kind="markdown" />);
  expect(await screen.findByText(/未提取到可预览文字/)).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
});

it("immediately hides the previous PDF and releases its URL while a different document loads", async () => {
  const create = vi.fn().mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
  const revoke = vi.fn();
  let finishSecond!: (blob: Blob) => void;
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(["first"]) })
    .mockResolvedValueOnce({ ok: true, blob: () => new Promise<Blob>(resolve => { finishSecond = resolve; }) }));
  const view = render(<DocumentContentPreview url="/first" name="第一份.pdf" kind="pdf" />);
  await screen.findByTitle("第一份.pdf 预览");
  view.rerender(<DocumentContentPreview url="/second" name="第二份.pdf" kind="pdf" />);
  expect(screen.getByRole("status").textContent).toContain("正在加载");
  expect(document.querySelector("iframe")).toBeNull();
  expect(screen.queryByRole("link", { name: "打开原文件" })).toBeNull();
  expect(revoke).toHaveBeenCalledWith("blob:first");
  await waitFor(() => expect(finishSecond).toBeTypeOf("function"));
  await act(async () => { finishSecond(new Blob(["second"])); });
  expect((await screen.findByTitle("第二份.pdf 预览")).getAttribute("src")).toContain("blob:second");
});

it("recovers from an earlier preview error when another document is selected", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, json: async () => ({ data: { text: "新资料正文" } }) }));
  const view = render(<DocumentContentPreview url="/missing" name="旧资料.txt" kind="text" />);
  await screen.findByRole("alert");
  view.rerender(<DocumentContentPreview url="/valid" name="新资料.txt" kind="text" />);
  expect(screen.getByRole("status").textContent).toContain("正在加载");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(await screen.findByText("新资料正文")).toBeTruthy();
});

it("ignores a late old response after switching documents", async () => {
  let finishOld!: (value: { data: { text: string } }) => void;
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce({ ok: true, json: () => new Promise(resolve => { finishOld = resolve; }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { text: "当前资料" } }) }));
  const view = render(<DocumentContentPreview url="/slow" name="慢资料.txt" kind="text" />);
  await waitFor(() => expect(finishOld).toBeTypeOf("function"));
  view.rerender(<DocumentContentPreview url="/current" name="当前资料.txt" kind="text" />);
  await screen.findByText("当前资料");
  await act(async () => { finishOld({ data: { text: "已切走的旧资料" } }); });
  expect(screen.queryByText("已切走的旧资料")).toBeNull();
  expect(screen.getByText("当前资料")).toBeTruthy();
});

it("keeps original-file controls in a collapsible sidebar without replacing the PDF", async () => {
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:sidebar"), revokeObjectURL: vi.fn() });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob(["pdf"]) })));
  render(<DocumentContentPreview url="/private/pdf" name="侧栏资料.pdf" kind="pdf" />);
  const iframe = await screen.findByTitle("侧栏资料.pdf 预览");
  const sidebar = screen.getByRole("complementary", { name: "文件预览工具" });
  expect(within(sidebar).getByRole("link", { name: "下载原文件" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "收起预览工具" }));
  expect(screen.queryByRole("link", { name: "下载原文件" })).toBeNull();
  expect(screen.getByTitle("侧栏资料.pdf 预览")).toBe(iframe);
  fireEvent.click(screen.getByRole("button", { name: "展开预览工具" }));
  expect(screen.getByRole("link", { name: "打开原文件" })).toBeVisible();
});

it("starts preview tools collapsed on narrow screens", async () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:mobile"), revokeObjectURL: vi.fn() });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob(["pdf"]) })));
  render(<DocumentContentPreview url="/private/pdf" name="手机资料.pdf" kind="pdf" />);
  await screen.findByTitle("手机资料.pdf 预览");
  expect(screen.getByRole("button", { name: "展开预览工具" })).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("link", { name: "下载原文件" })).toBeNull();
});

it("lets a surrounding viewer own the only controls and receive truncation information", async () => {
  const onPreviewInfo = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: { text: "正文", truncated: true } }) })));
  render(<DocumentContentPreview url="/private/word" name="正文.docx" kind="docx" controls="external" onPreviewInfo={onPreviewInfo} />);
  expect(await screen.findByText("正文")).toBeVisible();
  expect(screen.queryByRole("complementary", { name: "文件预览工具" })).toBeNull();
  expect(screen.queryByText(/完整排版/)).toBeNull();
  await waitFor(() => expect(onPreviewInfo).toHaveBeenLastCalledWith({ truncated: true }));
});
