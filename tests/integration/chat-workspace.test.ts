import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { createChatConversation, createChatTurn, getChatConversation, listChatConversations } from "@/ai/chat-workspace";

let db: DatabaseSync;
const owner = { tenantId: "tenant", accountId: "alice" };
const other = { ...owner, accountId: "bob" };
const body = { prompt: "第一轮问题", consent: true, useKnowledge: false, skill: "summary" };
function gateway() { return { provider: "openai", model: "fixture", generateText: vi.fn().mockResolvedValue({ text: "第一轮回答", lineage: { actualModel: "fixture", usage: { inputTokens: 10 } } }) }; }
function conversation() { return createChatConversation(db, owner, { id: randomUUID() }); }
function knowledge(id: string, projectId: string, content: string) {
  db.prepare("INSERT INTO knowledge_entries(id,project_id,track,type,title,content,source_type,source_id,status,version,created_by,created_at,updated_at) VALUES (?,?,'半导体','research',?,?,'evidence','local','approved',1,'author','2026-09-04','2026-09-04')").run(id, projectId, id, content);
}
beforeEach(() => { db = createDatabase(":memory:"); initializeDatabase(db); seedDemoData(db); });
afterEach(() => { db.close(); });

it("creates idempotent private conversations and carries persisted multi-turn attachments", async () => {
  const chat = conversation(); const model = gateway();
  expect(createChatConversation(db, owner, { id: chat.id })).toEqual(chat);
  expect(() => createChatConversation(db, other, { id: chat.id })).toThrow(/不存在/);
  await createChatTurn(db, owner, chat.id, { ...body, context: "附件里的专属文字", attachmentName: "说明.txt" }, "one", () => model);
  await createChatTurn(db, owner, chat.id, { ...body, prompt: "继续解释" }, "two", () => model);
  expect(model.generateText.mock.calls[1][0].user).toContain("第一轮问题");
  expect(model.generateText.mock.calls[1][0].user).toContain("第一轮回答");
  expect(model.generateText.mock.calls[1][0].user).toContain("附件里的专属文字");
  expect(getChatConversation(db, owner, chat.id).turns).toHaveLength(2);
  expect(listChatConversations(db, owner)[0].title).toBe("第一轮问题");
  expect(listChatConversations(db, other)).toEqual([]);
  expect(() => getChatConversation(db, other, chat.id)).toThrow(/不存在/);
  expect(() => getChatConversation(db, { ...owner, tenantId: "other" }, chat.id)).toThrow(/不存在/);
});

it("searches only the selected project and drops old knowledge when scope changes", async () => {
  knowledge("source-a", "project-qiongxin", "甲项目机密：已完成量产验证");
  knowledge("source-b", "project-xinglan", "乙项目机密：准备客户测试");
  const chat = conversation(); const model = gateway();
  model.generateText.mockResolvedValueOnce({ text: "甲项目已完成量产验证。[S1]", lineage: { actualModel: "fixture", usage: {} } });
  const first = await createChatTurn(db, owner, chat.id, { ...body, prompt: "量产验证", useKnowledge: true, projectId: "project-qiongxin" }, "a", () => model);
  expect(first.sources[0].reference).toBe("S1");
  expect(model.generateText.mock.calls[0][0].user).toContain("甲项目机密");
  expect(model.generateText.mock.calls[0][0].user).not.toContain("乙项目机密");
  await createChatTurn(db, owner, chat.id, { ...body, prompt: "客户测试", useKnowledge: true, projectId: "project-xinglan" }, "b", () => model);
  expect(model.generateText.mock.calls[1][0].user).toContain("乙项目机密");
  expect(model.generateText.mock.calls[1][0].user).not.toContain("甲项目");
  const off = await createChatTurn(db, owner, chat.id, { ...body, projectId: "project-qiongxin" }, "off", () => model);
  expect(off.projectId).toBeNull(); expect(off.sources).toEqual([]);
  expect(model.generateText.mock.calls[2][0].user).not.toMatch(/甲项目|乙项目/);
});

it("does not retrieve when disabled, validates consent and project before any model call", async () => {
  const chat = conversation(); const model = gateway();
  await expect(createChatTurn(db, owner, chat.id, { ...body, consent: false }, "bad", () => model)).rejects.toThrow();
  await expect(createChatTurn(db, owner, chat.id, { ...body, useKnowledge: true }, "bad", () => model)).rejects.toThrow();
  await expect(createChatTurn(db, owner, chat.id, { ...body, useKnowledge: true, projectId: "missing" }, "bad", () => model)).rejects.toThrow(/项目不存在/);
  const empty = await createChatTurn(db, owner, chat.id, { ...body, useKnowledge: true, projectId: "project-qiongxin" }, "empty", () => model);
  expect(empty.status).toBe("failed"); expect(model.generateText).not.toHaveBeenCalled();
  db.exec("DROP TABLE knowledge_entries");
  expect((await createChatTurn(db, owner, chat.id, body, "disabled", () => model)).status).toBe("succeeded");
});

it("replays successes and failures safely, rejects conflicting keys and masks provider errors", async () => {
  const chat = conversation(); const model = gateway();
  const first = await createChatTurn(db, owner, chat.id, body, "same", () => model);
  expect((await createChatTurn(db, owner, chat.id, body, "same", () => model)).id).toBe(first.id);
  await expect(createChatTurn(db, owner, chat.id, { ...body, prompt: "修改" }, "same", () => model)).rejects.toThrow(/幂等/);
  model.generateText.mockRejectedValue(new Error("secret-api-key"));
  const failure = await createChatTurn(db, owner, chat.id, body, "fail", () => model);
  expect(failure.status).toBe("failed"); expect(JSON.stringify(failure)).not.toContain("secret-api-key");
  await createChatTurn(db, owner, chat.id, body, "fail", () => model);
  expect(model.generateText).toHaveBeenCalledTimes(2);
  model.generateText.mockResolvedValue({ text: "", lineage: { actualModel: "fixture", usage: {} } });
  expect((await createChatTurn(db, owner, chat.id, body, "blank", () => model)).status).toBe("failed");
});

it("isolates in-flight turns per account and recovers interrupted work on refresh", async () => {
  const chat = conversation(); const chat2 = conversation(); const model = gateway();
  let finish!: (value: unknown) => void;
  model.generateText.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = createChatTurn(db, owner, chat.id, body, "running", () => model);
  await vi.waitFor(() => expect(model.generateText).toHaveBeenCalledOnce());
  expect((await createChatTurn(db, owner, chat.id, body, "running", () => model)).status).toBe("running");
  await expect(createChatTurn(db, owner, chat2.id, body, "other", () => model)).rejects.toThrow(/执行中/);
  db.prepare("UPDATE ai_chat_turns SET created_at='2020-01-01' WHERE status='running'").run();
  expect(getChatConversation(db, owner, chat.id).turns[0].status).toBe("failed");
  finish({ text: "too late", lineage: { actualModel: "fixture", usage: {} } });
  expect((await pending).status).toBe("failed");
});

it("uses owned templates only and limits history without reusing historic citation labels", async () => {
  const chat = conversation(); const model = gateway();
  const { saveAITemplate } = await import("@/ai/workspace");
  const template = saveAITemplate(db, owner, { name: "自定义", instructions: "整理成行动项" });
  await expect(createChatTurn(db, owner, chat.id, { ...body, templateId: "missing" }, "missing", () => model)).rejects.toThrow(/Agent/);
  model.generateText.mockResolvedValue({ text: "历史答案[S1]".repeat(5000), lineage: { actualModel: "fixture", usage: {} } });
  await createChatTurn(db, owner, chat.id, { ...body, templateId: template.id }, "first", () => model);
  expect(model.generateText.mock.calls[0][0].system).toContain("整理成行动项");
  await createChatTurn(db, owner, chat.id, body, "next", () => model);
  const sent = model.generateText.mock.calls[1][0].user;
  expect(sent.length).toBeLessThan(35000); expect(sent).not.toContain("[S1]");
  expect(getChatConversation(db, owner, chat.id).turns[1].warnings.join(" ")).toContain("历史");
});

it("keeps bounded excerpts of long attachments available to follow-up questions", async () => {
  const chat = conversation(); const model = gateway();
  await createChatTurn(db, owner, chat.id, { ...body, context: "材料标题：工程样机验证完成。" + "详细测试记录".repeat(6000) }, "long-file", () => model);
  const next = await createChatTurn(db, owner, chat.id, { ...body, prompt: "上份资料的主要结论是什么？" }, "followup", () => model);
  expect(model.generateText.mock.calls[1][0].user).toContain("工程样机验证完成");
  expect(next.warnings.join(" ")).toContain("历史");
  expect(model.generateText.mock.calls[1][0].user.length).toBeLessThan(35000);
});
