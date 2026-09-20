import { withApiAuth } from "@/security/api-auth";
import { handleExecuteSkill } from "@/api/skill-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleExecuteSkill(request, (await params).id);
}

export const POST = withApiAuth(handlePOST);
