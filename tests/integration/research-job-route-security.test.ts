import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/v1/research/jobs/route";

describe("research job route security", () => {
  it.each([
    ["x-tenant-id", "tenant-attacker"],
    ["x-user-id", "user-attacker"],
    ["x-role", "org_admin"],
  ])("rejects client security override header %s before parsing the body", async (name, value) => {
    const response = await POST(new Request("http://localhost/api/v1/research/jobs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [name]: value,
      },
      body: "{}",
    }));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("SECURITY_CONTEXT_OVERRIDE");
  });
});
