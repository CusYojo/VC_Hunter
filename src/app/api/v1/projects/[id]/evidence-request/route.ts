import { withApiAuth } from "@/security/api-auth";
import { handleEvidenceRequest } from "@/api/project-handlers";
import { getAppRepository } from "@/db/app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleEvidenceRequest(request, getAppRepository(), (await params).id);
}

export const POST = withApiAuth(handlePOST);
