import { getAppDatabase } from "@/db/app";
import { handleDiscoveryItemUpdate } from "@/intelligence/http";
import { withApiAuth } from "@/security/api-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const PATCH = withApiAuth((request: Request, { params }: { params: Promise<{ id: string }> }) => params.then(({ id }) => handleDiscoveryItemUpdate(request, getAppDatabase(), id)));
