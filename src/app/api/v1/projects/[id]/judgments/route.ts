import { withApiAuth } from "@/security/api-auth";
import { getAppDatabase } from "@/db/app";
import { handleRecordJudgment } from "@/workbench/http";
import { SqliteWorkbenchRepository } from "@/workbench/repository";
import { getCurrentUser } from "@/workbench/team";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) { return handleRecordJudgment(request, new SqliteWorkbenchRepository(getAppDatabase()), getCurrentUser(), (await params).id); }

export const POST = withApiAuth(handlePOST);
