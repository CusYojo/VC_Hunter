import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { aiWorkspaceMigration } from "@/db/ai-workspace-migration";
import { createAIRun, listAIRuns, saveAITemplate, listAITemplates, deleteAITemplate } from "@/ai/workspace";

let database: DatabaseSync;
const actor = { tenantId: "tenant-a", accountId: "account-a" };
const other = { tenantId: "tenant-a", accountId: "account-b" };
const input = { prompt: "概括本次会议重点", context: "会议讨论了三个问题。", consent: true, skill: "summary" };
const gateway = () => ({ provider: "openai", model: "test-model", generateText: vi.fn(async () => ({ text: "待核验摘要", lineage: { usage: { inputTokens: 20, outputTokens: 10 }, actualModel: "test-model" } })) });
beforeEach(() => { database = new DatabaseSync(":memory:"); database.exec(aiWorkspaceMigration.upSql); });
afterEach(() => database.close());

it("stores a real model result privately and replays a completed request without spending again", async () => {
  const model = gateway();
  const first = await createAIRun(database, actor, input, "request-1", model);
  expect(first).toMatchObject({ status: "succeeded", output: "待核验摘要", provider: "openai", model: "test-model" });
  expect((await createAIRun(database, actor, input, "request-1", model)).id).toBe(first.id);
  expect(model.generateText).toHaveBeenCalledTimes(1);
  expect(listAIRuns(database, actor)).toHaveLength(1);
  expect(listAIRuns(database, other)).toHaveLength(0);
  await expect(createAIRun(database, actor, { ...input, prompt: "changed" }, "request-1", model)).rejects.toThrow("幂等");
});

it("requires explicit consent and records a failed call without leaking provider errors", async () => {
  const model = gateway();
  await expect(createAIRun(database, actor, { ...input, consent: false }, "denied", model)).rejects.toThrow();
  expect(model.generateText).not.toHaveBeenCalled();
  model.generateText.mockRejectedValueOnce(new Error("authorization private-secret-key"));
  const failed = await createAIRun(database, actor, input, "fail", model);
  expect(failed.status).toBe("failed");
  expect(JSON.stringify(failed)).not.toContain("private-secret-key");
  expect(failed.error).toContain("调用失败");
});

it("keeps custom agents private and checks edit versions", () => {
  const template = saveAITemplate(database, actor, { name: "会议助手", instructions: "整理决议与待办" });
  expect(listAITemplates(database, actor)).toHaveLength(1);
  expect(listAITemplates(database, other)).toHaveLength(0);
  expect(() => saveAITemplate(database, other, { id: template.id, expectedVersion: 1, name: "偷改", instructions: "x" })).toThrow();
  expect(saveAITemplate(database, actor, { id: template.id, expectedVersion: 1, name: "纪要助手", instructions: "整理决议与待办" }).version).toBe(2);
  expect(() => deleteAITemplate(database, actor, template.id, 1)).toThrow("版本");
  deleteAITemplate(database, actor, template.id, 2);
  expect(listAITemplates(database, actor)).toHaveLength(0);
});

it("does not allow selecting someone else's custom agent or client identity fields", async () => {
  const template = saveAITemplate(database, other, { name: "私人助手", instructions: "私人指令" });
  await expect(createAIRun(database, actor, { ...input, templateId: template.id }, "private-template", gateway())).rejects.toThrow();
  await expect(createAIRun(database, actor, { ...input, accountId: "account-b" }, "spoof", gateway())).rejects.toThrow();
});
