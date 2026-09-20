import { personalSearchMode } from "@/ai/search-mode";
import { identityScope } from "@/security/identity-scope";
import { createPersonalModelGateway, PersonalAIRequiredError } from "@/ai/personal-model";
import { withApiAuth } from "@/security/api-auth";
import { dataResponse, errorResponse } from "@/api/envelope";
import { getAppDatabase } from "@/db/app";
import { handleCreateDiscoveryJob } from "@/workbench/http";
import { SqliteWorkbenchRepository } from "@/workbench/repository";
import { getCurrentUser } from "@/workbench/team";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function handleGET(request: Request) { const items = new SqliteWorkbenchRepository(getAppDatabase()).listDiscoveryJobs(); return dataResponse(request, { items, total: items.length, searchMode: personalSearchMode(getAppDatabase(), identityScope.getStore()) }); }
function handlePOST(request: Request) {
  try {
    const identity = identityScope.getStore();
    if (identity) createPersonalModelGateway(getAppDatabase(), identity);
    return handleCreateDiscoveryJob(request, new SqliteWorkbenchRepository(getAppDatabase()), getCurrentUser());
  } catch (error) {
    if (error instanceof PersonalAIRequiredError) return errorResponse(request, 409, error.code, error.message);
    return errorResponse(request, 500, "AI_CONFIGURATION_UNAVAILABLE", "个人 AI 配置暂不可用，请检查设置。");
  }
}

export const GET = withApiAuth(handleGET);
export const POST = withApiAuth(handlePOST);
