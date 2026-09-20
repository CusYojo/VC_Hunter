import { z } from "zod";
import { candidateQueueFiltersSchema } from "@/workbench/candidate-queue-contracts";
import { identityScope } from "@/security/identity-scope";
import { readAIBody } from "@/ai/workspace-http";
import { createManualCandidate } from "@/workbench/manual-candidate";
import { withApiAuth } from "@/security/api-auth";
import { dataResponse, errorResponse } from "@/api/envelope";
import { getAppDatabase } from "@/db/app";
import { SqliteWorkbenchRepository } from "@/workbench/repository";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function handleGET(request: Request) {
  try {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const filters = candidateQueueFiltersSchema.parse({ period: "today", ...params });
    const items = new SqliteWorkbenchRepository(getAppDatabase()).listCandidates(filters);
    return dataResponse(request, { items, total: items.length });
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse(request, 400, "INVALID_INPUT", "请检查日期、时段和筛选条件。");
    return errorResponse(request, 500, "CANDIDATES_UNAVAILABLE", "候选列表暂不可用。");
  }
}

export const GET = withApiAuth(handleGET);

export const POST = withApiAuth(async (request: Request) => {
  const owner = identityScope.getStore();
  if (!owner) return errorResponse(request, 401, "AUTH_REQUIRED", "请先登录。");
  try {
    const bytes = await readAIBody(request, 21 * 1024 * 1024);
    const form = await new Response(new Uint8Array(bytes), { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
    const file = form.get("file");
    if (!(file instanceof File)) return errorResponse(request, 400, "FILE_REQUIRED", "请选择原始资料文件。");
    const data = createManualCandidate(getAppDatabase(), JSON.parse(String(form.get("data") ?? "{}")), { name: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }, owner, request.headers.get("idempotency-key") ?? "");
    return dataResponse(request, data, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "幂等键已用于不同请求。") return errorResponse(request, 409, "IDEMPOTENCY_CONFLICT", error.message);
    return errorResponse(request, 400, "CANDIDATE_INVALID", "线索保存失败，请确认项目名称、赛道、摘要和 20 MB 以内的 PDF、DOCX、TXT 或 Markdown 文件。");
  }
});
