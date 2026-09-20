// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DocumentContentPreview } from "@/components/document-content-preview";
afterEach(() => vi.unstubAllGlobals());
it("renders authenticated comment photos as images and releases their private blob URLs", async () => {
  const revoke = vi.fn(); vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:private-photo"), revokeObjectURL: revoke });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob(["png"], { type: "image/png" }) })));
  const view = render(<DocumentContentPreview url="/private/comment/photo" name="现场照片.png" kind="image" />);
  expect((await screen.findByRole("img", { name: "现场照片.png" })).getAttribute("src")).toBe("blob:private-photo");
  expect(document.querySelector("iframe")).toBeNull();
  expect(screen.queryByText(/PDF 原文件/)).toBeNull();
  view.unmount(); expect(revoke).toHaveBeenCalledWith("blob:private-photo");
});
it("refuses an SVG response even when an attachment claims to be an image", async () => {
  const create = vi.fn(); vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: vi.fn() });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob(["<svg/>"], { type: "image/svg+xml" }) })));
  render(<DocumentContentPreview url="/private/invalid" name="伪造.png" kind="image" />);
  expect((await screen.findByRole("alert")).textContent).toContain("图片");
  expect(create).not.toHaveBeenCalled();
});
