import { expect, test } from "@playwright/test";

const sizes = [
  { width: 1440, height: 1000 },
  { width: 1280, height: 900 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 390, height: 844 },
  { width: 375, height: 812 },
];

const routes = ["/", "/projects", "/projects/project-qiongxin?view=dd", "/approvals", "/finance?view=contracts"];

for (const viewport of sizes) {
  test(`key workspaces fit ${viewport.width}px without page overflow`, async ({ page }) => {
    await page.setViewportSize(viewport);
    for (const route of routes) {
      await page.goto(route);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${route} overflows horizontally`).toBeLessThanOrEqual(1);
    }

    if (viewport.width <= 390) {
      await expect(page.getByRole("navigation", { name: "移动端导航" })).toBeVisible();
      const undersized = await page.locator("button:visible, [role=tab]:visible, select:visible").evaluateAll((elements) => elements.filter((element) => element.getBoundingClientRect().height < 44).map((element) => ({ text: element.textContent, height: element.getBoundingClientRect().height })));
      expect(undersized).toEqual([]);
    }
  });
}
