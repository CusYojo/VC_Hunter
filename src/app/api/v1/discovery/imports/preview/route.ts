import { getAppDatabase } from "@/db/app";
import { handleImportPreview } from "@/intelligence/http";
import { withApiAuth } from "@/security/api-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = withApiAuth((request: Request) => handleImportPreview(request, getAppDatabase()));
