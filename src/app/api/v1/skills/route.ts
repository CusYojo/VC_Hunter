import { withApiAuth } from "@/security/api-auth";
import { handleListSkills } from "@/api/skill-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(request: Request) {
  return handleListSkills(request);
}

export const GET = withApiAuth(handleGET);
