import { withApiAuth } from "@/security/api-auth";
import { getIntelligenceRepository } from "@/db/app";
import { handleGetTopicKnowledgeCards } from "@/api/intelligence-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(request: Request) {
  return handleGetTopicKnowledgeCards(request, getIntelligenceRepository());
}

export const GET = withApiAuth(handleGET);
