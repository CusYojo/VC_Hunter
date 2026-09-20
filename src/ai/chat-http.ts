import { z } from "zod";
import { dataResponse, errorResponse } from "@/api/envelope";
import { getAppDatabase } from "@/db/app";
import { identityScope } from "@/security/identity-scope";
import { createPersonalModelGateway } from "./personal-model";
import { readAIBody } from "./workspace-http";
import { ChatError, createChatConversation, createChatTurn, getChatConversation, listChatConversations } from "./chat-workspace";

function chatErrorResponse(request: Request, error: unknown) {
  if (error instanceof ChatError) {
    const status = error.code === "INVALID_IDENTITY" ? 401 : error.code === "NOT_FOUND" || error.code === "PROJECT_NOT_FOUND" ? 404 : 409;
    return errorResponse(request, status, error.code, error.message);
  }
  if (error instanceof RangeError) return errorResponse(request, 413, "PAYLOAD_TOO_LARGE", "问题或附件内容过长。");
  if (error instanceof z.ZodError || error instanceof SyntaxError) return errorResponse(request, 400, "INVALID_INPUT", "请检查输入、选择知识库项目，并同意将本次内容发送给自己的模型。");
  return errorResponse(request, 502, "CHAT_FAILED", "对话暂不可用，请稍后重试。");
}
export async function handleChatConversations(request: Request) {
  const owner = identityScope.getStore();
  if (!owner) return errorResponse(request, 401, "AUTH_REQUIRED", "请先登录。");
  try {
    const db = getAppDatabase();
    if (request.method === "GET") return dataResponse(request, listChatConversations(db, owner));
    const body = JSON.parse((await readAIBody(request, 1000)).toString("utf8"));
    return dataResponse(request, createChatConversation(db, owner, body));
  } catch (error) { return chatErrorResponse(request, error); }
}
export async function handleChatConversation(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = identityScope.getStore();
  if (!owner) return errorResponse(request, 401, "AUTH_REQUIRED", "请先登录。");
  try {
    const { id } = await params; const db = getAppDatabase();
    if (request.method === "GET") return dataResponse(request, getChatConversation(db, owner, id));
    const body = JSON.parse((await readAIBody(request, 300000)).toString("utf8"));
    const turn = await createChatTurn(db, owner, id, body, request.headers.get("idempotency-key") ?? "", () => createPersonalModelGateway(db, owner));
    return dataResponse(request, turn, { status: turn.status === "failed" ? 502 : 200 });
  } catch (error) { return chatErrorResponse(request, error); }
}
