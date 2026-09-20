import { withApiAuth } from "@/security/api-auth";
import { getAppDatabase } from "@/db/app";
import { handleAISettings } from "@/ai/settings-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handler = withApiAuth((request: Request) => handleAISettings(request, getAppDatabase()));
export const GET = handler;
export const PUT = handler;
export const DELETE = handler;
