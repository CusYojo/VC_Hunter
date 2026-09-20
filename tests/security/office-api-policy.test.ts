import { describe, expect, it } from "vitest";
import { authorizeApiRequest } from "@/security/api-policy";

describe("office mutation permissions", () => {
  it("allows members to customize themselves and submit avatars", () => {
    expect(authorizeApiRequest("PATCH", "/api/v1/organization/office/me", ["viewer"])).toBe(true);
    expect(authorizeApiRequest("PATCH", "/api/v1/organization/office/profile", ["viewer"])).toBe(true);
    expect(authorizeApiRequest("POST", "/api/v1/organization/office/avatar", ["viewer"])).toBe(true);
  });
  it("restricts layout and avatar review to administrators", () => {
    for (const path of ["/api/v1/admin/organization/office/layout", "/api/v1/admin/organization/office/avatars/a1"]) {
      expect(authorizeApiRequest("PATCH", path, ["org_admin"])).toBe(true);
      expect(authorizeApiRequest("PATCH", path, ["investment_manager"])).toBe(false);
    }
  });
});
