import { withApiAuth } from "@/security/api-auth";
import { getAppDatabase } from "@/db/app";
import { dataResponse, errorResponse } from "@/api/envelope";
import { searchWorkspace } from "@/workbench/workspace-search";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withApiAuth(async (request: Request) => {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  if (query.length > 100) return errorResponse(request, 400, "INVALID_QUERY", "搜索关键词不能超过 100 字。");
  try { return dataResponse(request, { items: searchWorkspace(getAppDatabase(), query) }); }
  catch { return errorResponse(request, 500, "SEARCH_FAILED", "搜索暂不可用，请稍后重试。"); }
});
