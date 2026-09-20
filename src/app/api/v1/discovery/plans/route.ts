import { getAppDatabase } from "@/db/app";
import { handleDiscoveryPlans } from "@/intelligence/http";
import { withApiAuth } from "@/security/api-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withApiAuth((request: Request) => handleDiscoveryPlans(request, getAppDatabase()));
export const PATCH = withApiAuth((request: Request) => handleDiscoveryPlans(request, getAppDatabase()));
