import { withApiAuth } from "@/security/api-auth";
import { dataResponse } from "@/api/envelope";
import { loadTeamMembers } from "@/workbench/team";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function handleGET(request: Request) { const items = loadTeamMembers(); return dataResponse(request, { items, total: items.length }); }

export const GET = withApiAuth(handleGET);
