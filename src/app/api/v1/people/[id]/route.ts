import { withApiAuth } from "@/security/api-auth";
import { getIntelligenceRepository } from "@/db/app";
import { handleGetPerson } from "@/api/intelligence-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleGetPerson(request, getIntelligenceRepository(), (await params).id);
}

export const GET = withApiAuth(handleGET);
