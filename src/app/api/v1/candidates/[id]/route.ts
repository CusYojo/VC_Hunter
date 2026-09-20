import { z } from "zod";
import { withApiAuth } from "@/security/api-auth";
import { identityScope } from "@/security/identity-scope";
import { getAppDatabase } from "@/db/app";
import { readAIBody } from "@/ai/workspace-http";
import { dataResponse, errorResponse } from "@/api/envelope";
import { CandidateAdminError, editCandidate } from "@/workbench/candidate-admin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const PATCH = withApiAuth(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const owner = identityScope.getStore();
  if (!owner) return errorResponse(request,401,"AUTH_REQUIRED","请先登录。");
  try {
    const body = JSON.parse((await readAIBody(request,100000)).toString("utf8"));
    return dataResponse(request,editCandidate(getAppDatabase(),owner,(await params).id,body,request.headers.get("idempotency-key") ?? ""));
  } catch (error) {
    if (error instanceof CandidateAdminError) return errorResponse(request,error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : error.code === "CONFLICT" ? 409 : 400,error.code,error.message);
    if (error instanceof RangeError) return errorResponse(request,413,"PAYLOAD_TOO_LARGE","编辑内容过长。");
    if (error instanceof z.ZodError || error instanceof SyntaxError) return errorResponse(request,400,"INVALID_INPUT","请检查项目名称、赛道、摘要和融资日期。");
    return errorResponse(request,500,"EDIT_FAILED","项目内容保存失败，请稍后重试。");
  }
});
