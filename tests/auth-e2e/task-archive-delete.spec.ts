import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { readAuthFixture } from "./fixtures";
import { login } from "./login";

const origin = "http://127.0.0.1:3107";

test("archives and then deletes an owned task from the work board", async ({ page }) => {
  await login(page, readAuthFixture().admin);
  const title = `待办归档删除验收-${randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/v1/activity", {
    headers: { origin, "idempotency-key": randomUUID() },
    data: { kind: "task", title, participantIds: [] },
  });
  expect(created.status()).toBe(200);

  await page.goto("/work");
  const card = () => page.getByRole("article").filter({ has: page.getByRole("button", { name: `事项概览：${title}`, exact: true }) });
  await card().getByRole("button", { name: `事项概览：${title}`, exact: true }).click();
  const [archived] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/lifecycle") && response.request().method() === "POST"),
    card().getByRole("button", { name: `归档待办：${title}`, exact: true }).click(),
  ]);
  expect(archived.status()).toBe(200);
  await expect(card()).toHaveCount(0);

  await page.getByRole("button", { name: "已归档", exact: true }).click();
  await expect(card()).toBeVisible();
  await card().getByRole("button", { name: `事项概览：${title}`, exact: true }).click();
  await card().getByRole("button", { name: `删除待办：${title}`, exact: true }).click();
  await expect(card().getByText("删除后将从所有待办列表隐藏，但审计记录仍会保留。", { exact: true })).toBeVisible();
  const [deleted] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/lifecycle") && response.request().method() === "POST"),
    card().getByRole("button", { name: "确认删除待办", exact: true }).click(),
  ]);
  expect(deleted.status()).toBe(200);
  await expect(card()).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "已归档", exact: true }).click();
  await expect(card()).toHaveCount(0);
});
