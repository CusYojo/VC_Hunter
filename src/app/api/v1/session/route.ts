import { withApiAuth } from "@/security/api-auth";
import { handleGetSession } from "@/workbench/http";
import { getCurrentUser } from "@/workbench/team";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function handleGET(request: Request) { return handleGetSession(request, getCurrentUser()); }

export const GET = withApiAuth(handleGET);
