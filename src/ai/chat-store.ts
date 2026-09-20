import type { DatabaseSync } from "node:sqlite";
import type { ChatConversation, ChatTurn } from "./chat-contracts";

export type ChatOwner = { tenantId: string; accountId: string };
export class ChatError extends Error {
  constructor(readonly code: "NOT_FOUND" | "PROJECT_NOT_FOUND" | "KNOWLEDGE_EMPTY" | "BUSY" | "IDEMPOTENCY_CONFLICT" | "INVALID_IDENTITY" | "TEMPLATE_NOT_FOUND", message: string) { super(message); }
}
export const conversationColumns = "id,title,created_at AS createdAt,updated_at AS updatedAt";
export const turnColumns = `id,conversation_id AS conversationId,prompt,context,attachment_name AS attachmentName,skill,
  project_id AS projectId,use_knowledge AS useKnowledge,status,output,error,provider,model,
  sources_json,warnings_json,usage_json,created_at AS createdAt,updated_at AS updatedAt`;
export function authorizeChatOwner(owner: ChatOwner) {
  if (!owner.tenantId.trim() || !owner.accountId.trim()) throw new ChatError("INVALID_IDENTITY", "账号身份无效。");
}
export function requireConversation(db: DatabaseSync, owner: ChatOwner, id: string): ChatConversation {
  authorizeChatOwner(owner);
  const row = db.prepare(`SELECT ${conversationColumns} FROM ai_chat_conversations WHERE id=? AND tenant_id=? AND account_id=?`).get(id, owner.tenantId, owner.accountId);
  if (!row) throw new ChatError("NOT_FOUND", "对话不存在。");
  return row as unknown as ChatConversation;
}
export function turnView(row: Record<string, unknown>): ChatTurn {
  const { sources_json, warnings_json, usage_json, payload_hash: hash, ...data } = row;
  void hash;
  return { ...data, useKnowledge: Boolean(data.useKnowledge), sources: JSON.parse(String(sources_json)), warnings: JSON.parse(String(warnings_json)), usage: JSON.parse(String(usage_json)) } as unknown as ChatTurn;
}
export function findChatTurn(db: DatabaseSync, owner: ChatOwner, conversationId: string, key: string) {
  return db.prepare(`SELECT ${turnColumns},payload_hash FROM ai_chat_turns WHERE tenant_id=? AND account_id=? AND conversation_id=? AND request_key=?`).get(owner.tenantId, owner.accountId, conversationId, key);
}
export function recoverChatTurns(db: DatabaseSync, owner: ChatOwner) {
  db.prepare("UPDATE ai_chat_turns SET status='failed',error='执行中断，请重新提问。',updated_at=? WHERE tenant_id=? AND account_id=? AND status='running' AND created_at<?")
    .run(new Date().toISOString(), owner.tenantId, owner.accountId, new Date(Date.now() - 5 * 60000).toISOString());
}
export function replayChatTurn(row: Record<string, unknown>, hash: string): ChatTurn {
  if (row.payload_hash !== hash) throw new ChatError("IDEMPOTENCY_CONFLICT", "幂等键已用于其他问题。");
  return turnView(row);
}

/** Only a contiguous, matching knowledge scope is eligible for follow-up context. */
export function chatHistory(db: DatabaseSync, owner: ChatOwner, conversationId: string, currentId: string, projectId: string | null) {
  const rows = db.prepare(`SELECT ${turnColumns} FROM ai_chat_turns WHERE tenant_id=? AND account_id=? AND conversation_id=? AND id<>? ORDER BY rowid DESC LIMIT 21`).all(owner.tenantId, owner.accountId, conversationId, currentId);
  const parts: string[] = [];
  let length = 0;
  let truncated = false;
  for (const row of rows) {
    const turn = turnView(row);
    if (turn.projectId !== projectId) break;
    if (turn.status !== "succeeded") continue;
    const clean = (value: string) => value.replace(/\[S\d+\]/g, "[历史引用已省略]");
    const excerpt = (value: string, limit: number) => {
      const text = clean(value);
      if (text.length <= limit) return text;
      truncated = true;
      return `${text.slice(0, limit)}\n[历史内容较长，仅保留此段；后续内容未纳入]`;
    };
    const part = JSON.stringify({ question: excerpt(turn.prompt, 4000), attachment: excerpt(turn.context, 11000), answer: excerpt(turn.output, 6000) });
    if (parts.length >= 20 || length + part.length > 24000) { truncated = true; break; }
    parts.unshift(part);
    length += part.length;
  }
  return { text: parts.join("\n"), truncated };
}
