import { withApiAuth } from "@/security/api-auth";
import { dataResponse } from "@/api/envelope";
import { getAppDatabase } from "@/db/app";
import { listKnowledgeCards } from "@/repositories/dashboard-data";
import { SqliteWorkbenchRepository } from "@/workbench/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(request: Request) {
  const url = new URL(request.url);
  const cards = listKnowledgeCards(getAppDatabase());
  const items = new SqliteWorkbenchRepository(getAppDatabase()).listKnowledge({ status: url.searchParams.get("status") ?? undefined, track: url.searchParams.get("track") ?? undefined, projectId: url.searchParams.get("projectId") ?? undefined, type: url.searchParams.get("type") ?? undefined });
  return dataResponse(request, { items, cards, total: items.length });
}

export const GET = withApiAuth(handleGET);
