import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

// Exercises the actual cascade, including legacy CSS, without a database or login fixture.
test("blue actions and selected links retain white text without changing grey controls", async ({ page }) => {
  const css = await postcss([tailwind()]).process(readFileSync("src/app/tailwind.css", "utf8"), { from: "src/app/tailwind.css" });
  await page.setContent(`<style>${css.css}${readFileSync("src/app/globals.css", "utf8")}</style>
    <a href="#action" class="bg-primary text-primary-foreground">链接按钮</a>
    <button class="bg-primary text-primary-foreground">主要按钮</button>
    <a href="#tab" role="tab" aria-selected="true" class="bg-primary text-primary-foreground">选中标签</a>
    <a href="#grey" class="bg-muted text-foreground">灰底控件</a>`);
  for (const text of ["链接按钮", "主要按钮", "选中标签"]) {
    await expect(page.getByText(text, { exact: true })).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(page.getByText(text, { exact: true })).toHaveCSS("background-color", "rgb(36, 91, 219)");
  }
  await expect(page.getByText("灰底控件")).toHaveCSS("color", "rgb(31, 35, 41)");
  await expect(page.getByText("灰底控件")).toHaveCSS("background-color", "rgb(238, 241, 245)");
});
