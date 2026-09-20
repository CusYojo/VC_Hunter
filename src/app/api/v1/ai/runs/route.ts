import { withApiAuth } from "@/security/api-auth";
import { handleAIRuns } from "@/ai/workspace-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withApiAuth(handleAIRuns);
export const POST = withApiAuth(handleAIRuns);
