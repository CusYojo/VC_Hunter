import { z } from "zod";
import { withApiAuth } from "@/security/api-auth";
import { identityScope } from "@/security/identity-scope";
import { getAppDatabase } from "@/db/app";
import { dataResponse, errorResponse } from "@/api/envelope";
import { listProjectFiles } from "@/workbench/project-files";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withApiAuth((request: Request) => {
  if (!identityScope.getStore()) return errorResponse(request, 401, "AUTH_REQUIRED", "请先登录。");
  try { return dataResponse(request, listProjectFiles(getAppDatabase(), Object.fromEntries(new URL(request.url).searchParams))); }
  catch (error) {
    if (error instanceof z.ZodError) return errorResponse(request, 400, "INVALID_INPUT", "资料筛选参数无效。");
    return errorResponse(request, 500, "FILES_UNAVAILABLE", "项目资料暂不可用。");
  }
});
