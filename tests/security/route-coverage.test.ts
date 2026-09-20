import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)]);
}
it("every business API export passes through request authentication", () => {
  for (const path of files("src/app/api/v1").filter((file) => file.endsWith("/route.ts"))) {
    const source = readFileSync(path, "utf8");
    expect(source, path).toContain('from "@/security/api-auth"');
    expect(source, path).not.toMatch(/export\s+(async\s+)?function\s+(GET|POST|PATCH|PUT|DELETE)/);
  }
});
it("every business page checks the session before reading data", () => {
  for (const path of files("src/app").filter((file) => file.endsWith("/page.tsx") && !/\/(login|two-factor)\//.test(file))) {
    expect(readFileSync(path, "utf8"), path).toContain("await requirePageUser()");
  }
});
