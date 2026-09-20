import { withApiAuth } from "@/security/api-auth";
import { dataResponse } from "@/api/envelope";
import { analysisProfileRegistry } from "@/workbench/analysis-profiles";
export const runtime = "nodejs";
function handleGET(request: Request) { const items = analysisProfileRegistry.list(); return dataResponse(request, { items, total: items.length }); }

export const GET = withApiAuth(handleGET);
