import { describe, expect, it, vi } from "vitest";
import { handleOfficeAvatarRequest } from "@/organization/office-avatar-http";
import { createAvatarTemplate, AVATAR_MAX_BYTES } from "@/organization/office-avatar";
import type { OfficeAvatarService } from "@/organization/office-avatar-service";

const actor = { tenantId: "tenant", accountId: "account", memberId: "member", canManage: false };
const submission = { id: "avatar", memberId: "member", memberName: "成员", status: "pending", version: 1, avatarUrl: "/api/v1/organization/office/avatars/avatar", reviewNote: "", createdAt: "2026-09-04T00:00:00.000Z", reviewedAt: null };
function fixture() {
  const service = { submit: vi.fn().mockResolvedValue(submission), latest: vi.fn().mockReturnValue(submission), list: vi.fn().mockReturnValue([submission]), read: vi.fn(), review: vi.fn().mockReturnValue({ ...submission, status: "approved", version: 2 }) };
  return { service, handle: (request: Request, operation: Parameters<typeof handleOfficeAvatarRequest>[3], id?: string) => handleOfficeAvatarRequest(request, service as unknown as OfficeAvatarService, actor, operation, id) };
}
function upload(file?: File, extras = false) {
  const form = new FormData(); if (file) form.set("file", file); if (extras) form.set("memberId", "someone-else");
  return new Request("http://localhost/api/v1/organization/office/avatar", { method: "POST", headers: { "idempotency-key": "submission-1" }, body: form });
}

describe("office avatar HTTP boundary", () => {
  it("requires an authenticated actor before invoking the service", async () => {
    const { service } = fixture();
    const response = await handleOfficeAvatarRequest(upload(), service as unknown as OfficeAvatarService, null, "upload");
    expect(response.status).toBe(401); expect(service.submit).not.toHaveBeenCalled();
  });
  it("accepts only one PNG file and scopes upload to the supplied authenticated actor", async () => {
    const { handle, service } = fixture();
    const png = await createAvatarTemplate();
    const response = await handle(upload(new File([new Uint8Array(png)], "avatar.png", { type: "image/png" })), "upload");
    expect(response.status).toBe(201);
    expect((await response.json()).data).toMatchObject({ id: "avatar", memberId: "member" });
    expect(service.submit).toHaveBeenCalledWith(actor, expect.any(Uint8Array), "submission-1");
    for (const request of [upload(), upload(new File(["bad"], "bad.jpg", { type: "image/jpeg" })), upload(new File(["bad"], "avatar.png", { type: "image/png" }), true)]) {
      expect((await handle(request, "upload")).status).toBe(400);
    }
    expect(service.submit).toHaveBeenCalledTimes(1);
  });
  it("bounds uploaded bytes even without a content-length header", async () => {
    const { handle, service } = fixture();
    const response = await handle(upload(new File([new Uint8Array(AVATAR_MAX_BYTES + 1)], "large.png", { type: "image/png" })), "upload");
    expect(response.status).toBe(413); expect(service.submit).not.toHaveBeenCalled();
    const oversized = new Request("http://localhost/api/v1/organization/office/avatar", { method: "POST", body: new Uint8Array(AVATAR_MAX_BYTES + 20_000) });
    expect((await handle(oversized, "upload")).status).toBe(413);
  });
  it("returns private PNG bytes and a downloadable template with nosniff", async () => {
    const { handle, service } = fixture(); const png = await createAvatarTemplate(); service.read.mockReturnValue(png);
    const response = await handle(new Request("http://localhost/api/v1/organization/office/avatars/avatar"), "image", "avatar");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    const template = await handle(new Request("http://localhost/api/v1/organization/office/avatar-template"), "template");
    expect(template.headers.get("content-disposition")).toContain("attachment");
  });
  it("returns the personal submission and admin queue in explicit envelopes", async () => {
    const { handle } = fixture(); const request = new Request("http://localhost/api/v1/organization/office/avatar");
    expect((await (await handle(request, "latest")).json()).data).toEqual({ item: submission });
    expect((await (await handle(request, "list")).json()).data).toEqual({ items: [submission] });
  });
  it("validates decisions, versions, extra fields and malformed JSON", async () => {
    const { handle, service } = fixture();
    const request = (body: string) => new Request("http://localhost/api/v1/admin/organization/office/avatars/avatar", { method: "PATCH", headers: { "content-type": "application/json" }, body });
    for (const body of ["{", JSON.stringify({ expectedVersion: 0, decision: "approve", note: "" }), JSON.stringify({ expectedVersion: 1, decision: "reject", note: " " }), JSON.stringify({ expectedVersion: 1, decision: "approve", note: "", memberId: "other" })]) {
      expect((await handle(request(body), "review", "avatar")).status).toBe(400);
    }
    expect(service.review).not.toHaveBeenCalled();
    expect((await handle(request(JSON.stringify({ expectedVersion: 1, decision: "reject", note: "请修改" })), "review", "avatar")).status).toBe(200);
  });
  it.each([Error, TypeError])("does not expose unexpected storage errors from %s", async ErrorType => {
    const { handle, service } = fixture(); service.read.mockImplementation(() => { throw new ErrorType("private storage path"); });
    const response = await handle(new Request("http://localhost/api/v1/organization/office/avatars/avatar"), "image", "avatar");
    expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain("private storage path");
  });
});
