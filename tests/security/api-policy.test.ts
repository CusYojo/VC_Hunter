import { describe, expect, it } from "vitest";
import { authorizeApiRequest, checkMutationOrigin, RequestRateLimiter } from "@/security/api-policy";

describe("private workspace API boundary", () => {
  it("requires a valid member even for read requests", () => {
    expect(authorizeApiRequest("GET", "/api/v1/projects", [])).toBe(false);
    expect(authorizeApiRequest("GET", "/api/v1/projects", ["viewer"])).toBe(true);
  });
  it("does not allow read-only users to mutate or invent routes", () => {
    expect(authorizeApiRequest("POST", "/api/v1/investors", ["viewer"])).toBe(false);
    expect(authorizeApiRequest("POST", "/api/v1/investors", ["investment_manager"])).toBe(true);
    expect(authorizeApiRequest("POST", "/api/v1/unknown", ["org_admin"])).toBe(false);
  });
  it("separates researcher writes from investment decisions", () => {
    expect(authorizeApiRequest("POST", "/api/v1/projects/p/documents", ["researcher"])).toBe(true);
    expect(authorizeApiRequest("POST", "/api/v1/discovery/items", ["researcher"])).toBe(true);
    expect(authorizeApiRequest("PATCH", "/api/v1/discovery/items/candidate", ["researcher"])).toBe(false);
    expect(authorizeApiRequest("PATCH", "/api/v1/discovery/items/candidate", ["org_admin"])).toBe(true);
    expect(authorizeApiRequest("PATCH", "/api/v1/projects/p/review", ["researcher"])).toBe(false);
    expect(authorizeApiRequest("PATCH", "/api/v1/projects/p/review", ["investment_manager"])).toBe(true);
  });
  it("requires same origin for every mutation, including absent origins", () => {
    expect(checkMutationOrigin("POST", new Headers(), "https://example.com")).toBe(false);
    expect(checkMutationOrigin("POST", new Headers({ origin: "https://evil.test" }), "https://example.com")).toBe(false);
    expect(checkMutationOrigin("POST", new Headers({ origin: "https://example.com" }), "https://example.com")).toBe(true);
    expect(checkMutationOrigin("GET", new Headers(), "https://example.com")).toBe(true);
  });
  it("rate limits by authenticated identity with stricter expensive writes", () => {
    const limiter = new RequestRateLimiter();
    for (let i = 0; i < 5; i++) expect(limiter.allow("u", "expensive", 100)).toBe(true);
    expect(limiter.allow("u", "expensive", 100)).toBe(false);
    expect(limiter.allow("other", "expensive", 100)).toBe(true);
    expect(limiter.allow("u", "expensive", 60_100)).toBe(true);
  });
});
