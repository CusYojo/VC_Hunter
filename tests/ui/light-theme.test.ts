import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const tokens = readFileSync(resolve("src/app/tailwind.css"), "utf8");
const legacy = readFileSync(resolve("src/app/globals.css"), "utf8");
const color = (name: string) => tokens.match(new RegExp(`--${name}:\\s*(#[a-fA-F0-9]{6})`))?.[1] ?? "";
function luminance(hex: string) {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

describe("office light theme", () => {
  it("uses neutral surfaces and blue primary actions", () => {
    expect(color("background")).toBe("#f5f6f8");
    expect(color("card")).toBe("#ffffff");
    expect(color("primary")).toBe("#245bdb");
    expect(legacy).not.toMatch(/--accent\s*:/);
    expect(`${tokens}\n${legacy}`).not.toMatch(/#(?:ebe8e2|fbfaf7|9f2d35|f3e6e2|e3e0da|f0dfdb|76272e|161616)/i);
  });

  it.each([
    ["foreground", "background"], ["card-foreground", "card"],
    ["muted-foreground", "muted"], ["muted-foreground", "background"],
    ["primary-foreground", "primary"], ["accent-foreground", "accent"],
    ["sidebar-foreground", "sidebar"], ["secondary-foreground", "secondary"],
  ])("keeps %s on %s at 4.5:1 contrast", (foreground, background) => {
    const a = luminance(color(foreground));
    const b = luminance(color(background));
    expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});
