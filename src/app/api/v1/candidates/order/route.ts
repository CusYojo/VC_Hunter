import { z } from "zod";
import { withApiAuth } from "@/security/api-auth";
import { identityScope } from "@/security/identity-scope";
import { getAppDatabase } from "@/db/app";
import { readAIBody } from "@/ai/workspace-http";
import { dataResponse, errorResponse } from "@/api/envelope";
import { CandidateQueueError, orderCandidateQueue } from "@/workbench/candidate-queue";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const PATCH = withApiAuth(async (request: Request) => {
  const owner = identityScope.getStore();
  if (!owner) return errorResponse(request, 401, "AUTH_REQUIRED", "请先登录。");
  try {
    const body = JSON.parse((await readAIBody(request, 40000)).toString("utf8"));
    return dataResponse(request, orderCandidateQueue(getAppDatabase(), owner, body, request.headers.get("idempotency-key") ?? ""));
  } catch (error) {
    if (error instanceof CandidateQueueError) return errorResponse(request, error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : error.code === "CONFLICT" ? 409 : 400, error.code, error.message);
    if (error instanceof RangeError) return errorResponse(request, 413, "PAYLOAD_TOO_LARGE", "排序请求过大。");
    if (error instanceof z.ZodError || error instanceof SyntaxError) return errorResponse(request, 400, "INVALID_INPUT", "排序参数无效。");
    return errorResponse(request, 500, "ORDER_FAILED", "排序保存失败，请稍后重试。");
  }
});
