import { withApiAuth } from "@/security/api-auth";
import { handleReviewProject } from "@/api/project-handlers";
import { getAppRepository } from "@/db/app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleReviewProject(request, getAppRepository(), (await params).id);
}

export const PATCH = withApiAuth(handlePATCH);
