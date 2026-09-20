import { withApiAuth } from "@/security/api-auth";
import { dataResponse, errorResponse } from "@/api/envelope";
import { getAppRepository } from "@/db/app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const evidence = getAppRepository().findEvidenceById((await params).id);
  return evidence ? dataResponse(request, evidence) : errorResponse(request, 404, "NOT_FOUND", "证据不存在。");
}

export const GET = withApiAuth(handleGET);
