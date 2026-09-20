import { withApiAuth } from "@/security/api-auth";
import { dataResponse } from "@/api/envelope";
import { getAppDatabase } from "@/db/app";
import { SqliteWorkbenchRepository } from "@/workbench/repository";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handleGET(request: Request, { params }: { params: Promise<{ id: string }> }) { const items = new SqliteWorkbenchRepository(getAppDatabase()).getTimeline((await params).id); return dataResponse(request, { items, total: items.length }); }

export const GET = withApiAuth(handleGET);
