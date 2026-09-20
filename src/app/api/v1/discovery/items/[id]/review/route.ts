import { getAppDatabase } from "@/db/app";
import { handleDiscoveryItemReview } from "@/intelligence/http";
import { withApiAuth } from "@/security/api-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const PATCH = withApiAuth((request: Request, { params }: { params: Promise<{ id: string }> }) => params.then(({ id }) => handleDiscoveryItemReview(request, getAppDatabase(), id)));
