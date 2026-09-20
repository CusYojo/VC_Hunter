import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const projectFile = (path: string) => new URL(`../../${path}`, import.meta.url);
const tailwindCss = readFileSync(projectFile("src/app/tailwind.css"), "utf8");
const authCss = readFileSync(projectFile("src/components/auth/auth.module.css"), "utf8");
const operatingSources = readdirSync(projectFile("src/components/operating"))
  .filter((name) => name.endsWith(".tsx") && !name.includes(" 2"))
  .map((name) => readFileSync(projectFile(`src/components/operating/${name}`), "utf8"))
  .join("\n");
const brandedSources = [
  tailwindCss,
  readFileSync(projectFile("src/app/globals.css"), "utf8"),
  readFileSync(projectFile("src/components/app-shell.tsx"), "utf8"),
  readFileSync(projectFile("src/components/ui/button.tsx"), "utf8"),
  operatingSources,
].join("\n");

describe("VC Hunter office color system", () => {
  it("uses a cool light gray application background", () => {
    expect(tailwindCss).toContain("--background: #f5f6f8;");
  });

  it("uses office blue as the primary highlight", () => {
    expect(tailwindCss).toContain("--primary: #245bdb;");
  });

  it("uses a deeper blue with white text for the login action", () => {
    expect(authCss).toContain("background: #183f9f; color: #fff;");
    expect(authCss).toContain("background: #12347f;");
  });

  it("removes the former warm brand palette from workspace surfaces", () => {
    expect(brandedSources).not.toMatch(/#ebe8e2|#9f2d35|#fbfaf7/i);
  });
});
