import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const projectFile = (path: string) => new URL(`../../${path}`, import.meta.url);
const tailwindCss = readFileSync(projectFile("src/app/tailwind.css"), "utf8");
const cardSource = readFileSync(projectFile("src/components/ui/card.tsx"), "utf8");
const buttonSource = readFileSync(projectFile("src/components/ui/button.tsx"), "utf8");
const shellSource = readFileSync(projectFile("src/components/app-shell.tsx"), "utf8");
const hubSource = readFileSync(projectFile("src/components/operating/hub-layout.tsx"), "utf8");

describe("restrained editorial workspace style", () => {
  it("defines a local editorial heading stack without requesting web fonts", () => {
    expect(tailwindCss).toContain("--font-editorial:");
    expect(tailwindCss).not.toMatch(/fonts\.googleapis\.com|@font-face/);
    expect(hubSource).toContain("font-editorial");
  });

  it("uses compact geometry and hairlines instead of decorative depth", () => {
    expect(cardSource).toContain("rounded-lg");
    expect(cardSource).not.toContain("rounded-2xl");
    expect(buttonSource).toContain("rounded-lg");
    expect(buttonSource).not.toContain("shadow-[");
    expect(shellSource).not.toMatch(/(?:radial|linear)-gradient/);
    expect(hubSource).not.toContain("blur-2xl");
  });
});
