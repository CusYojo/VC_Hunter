import { withApiAuth } from "@/security/api-auth";
import { getIntelligenceRepository } from "@/db/app";
import { handleGetMaEvents } from "@/api/intelligence-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(request: Request) {
  return handleGetMaEvents(request, getIntelligenceRepository());
}

export const GET = withApiAuth(handleGET);
