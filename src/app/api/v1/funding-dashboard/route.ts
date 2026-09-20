import { withApiAuth } from "@/security/api-auth";
import { getAppDatabase } from "@/db/app";
import { handleFundingDashboard } from "@/workbench/investor-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handleGET(request: Request) {
  return handleFundingDashboard(request, getAppDatabase());
}

export const GET = withApiAuth(handleGET);
