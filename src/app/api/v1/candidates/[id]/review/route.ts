import { withApiAuth } from "@/security/api-auth";
import { getAppDatabase } from "@/db/app";
import { handleReviewCandidate } from "@/workbench/http";
import { SqliteWorkbenchRepository } from "@/workbench/repository";
import { getCurrentUser } from "@/workbench/team";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string }> }) { return handleReviewCandidate(request, new SqliteWorkbenchRepository(getAppDatabase()), getCurrentUser(), (await params).id); }

export const PATCH = withApiAuth(handlePATCH);
