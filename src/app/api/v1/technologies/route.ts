import { getAppDatabase } from "@/db/app";
import { handleTechnologies } from "@/intelligence/http";
import { withApiAuth } from "@/security/api-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withApiAuth((request: Request) => handleTechnologies(request, getAppDatabase()));
