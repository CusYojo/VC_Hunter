import { withApiAuth } from "@/security/api-auth";
import { handleAITemplates } from "@/ai/workspace-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withApiAuth(handleAITemplates);
export const POST = withApiAuth(handleAITemplates);
export const DELETE = withApiAuth(handleAITemplates);
