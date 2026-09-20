import type { DatabaseSync } from "node:sqlite";
import { dataResponse, errorResponse } from "@/api/envelope";
import { identityScope } from "@/security/identity-scope";
import { aiProviderSettingsInputSchema, deleteAIProviderSettingsSchema } from "./settings-contracts";
import { AISettingsError, deleteAIProviderSettings, getSavedAISettings, saveAIProviderSettings } from "./settings-repository";

const MAX_SETTINGS_BYTES = 16_384;
export async function readSettingsJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Missing body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_SETTINGS_BYTES) { await reader.cancel(); throw new RangeError("Body too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export function aiSettingsErrorResponse(request: Request, error: unknown): Response {
  if (error instanceof RangeError) return errorResponse(request, 413, "PAYLOAD_TOO_LARGE", "配置内容超过大小限制。");
  if (error instanceof SyntaxError) return errorResponse(request, 400, "SCHEMA_INVALID", "请求体必须是有效 JSON。");
  if (error instanceof AISettingsError) return errorResponse(request, error.code === "ENCRYPTION_UNAVAILABLE" ? 503 : 400, error.code, error.message);
  return errorResponse(request, 500, "AI_SETTINGS_FAILED", "保存或读取 AI 设置失败，请稍后重试。");
}
export async function handleAISettings(request: Request, database: DatabaseSync): Promise<Response> {
  const respond = async (): Promise<Response> => {
    const identity = identityScope.getStore();
    if (!identity) return errorResponse(request, 401, "AUTH_REQUIRED", "请使用账号和密码登录。");
    try {
      if (request.method === "GET") return dataResponse(request, getSavedAISettings(database, identity));
      if (request.method === "PUT") {
        const parsed = aiProviderSettingsInputSchema.safeParse(await readSettingsJson(request));
        if (!parsed.success) return errorResponse(request, 400, "SCHEMA_INVALID", "请填写有效的服务商、模型和 API Key。");
        return dataResponse(request, saveAIProviderSettings(database, identity, parsed.data));
      }
      if (request.method === "DELETE") {
        const parsed = deleteAIProviderSettingsSchema.safeParse(await readSettingsJson(request));
        if (!parsed.success) return errorResponse(request, 400, "SCHEMA_INVALID", "请选择要移除的 AI 服务商。");
        return dataResponse(request, deleteAIProviderSettings(database, identity, parsed.data.provider));
      }
      return errorResponse(request, 405, "METHOD_NOT_ALLOWED", "不支持此操作。");
    } catch (error) { return aiSettingsErrorResponse(request, error); }
  };
  const response = await respond();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
