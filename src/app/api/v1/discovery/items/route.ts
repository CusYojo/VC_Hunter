import { getAppDatabase } from "@/db/app";
import { handleDiscoveryItems } from "@/intelligence/http";
import { withApiAuth } from "@/security/api-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withApiAuth((request: Request) => handleDiscoveryItems(request, getAppDatabase()));
export const POST = withApiAuth((request: Request) => handleDiscoveryItems(request, getAppDatabase()));
