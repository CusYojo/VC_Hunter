import { getAppDatabase } from "@/db/app";
import { handleImportCommit } from "@/intelligence/http";
import { withApiAuth } from "@/security/api-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = withApiAuth((request: Request, { params }: { params: Promise<{ id: string }> }) => params.then(({ id }) => handleImportCommit(request, getAppDatabase(), id)));
