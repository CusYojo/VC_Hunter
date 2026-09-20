import { getAppDatabase } from "@/db/app";
import { handleTechnologyDetail } from "@/intelligence/http";
import { withApiAuth } from "@/security/api-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withApiAuth((request: Request, { params }: { params: Promise<{ id: string }> }) => params.then(({ id }) => handleTechnologyDetail(request, getAppDatabase(), id)));
