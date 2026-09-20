import { withApiAuth } from "@/security/api-auth";
import { dataResponse, errorResponse } from "@/api/envelope";
import { getAppDatabase } from "@/db/app";
import { SqliteResearchJobRepository } from "@/repositories/research-jobs";
import { getCurrentTenantId } from "@/workbench/team";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handleGET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenantId = getCurrentTenantId();
  const row = getAppDatabase().prepare("SELECT idempotency_key FROM research_jobs WHERE id=? AND tenant_id=?").get(id, tenantId) as { idempotency_key: string } | undefined;
  if (!row) return errorResponse(request, 404, "NOT_FOUND", "研究任务不存在。");
  const job = new SqliteResearchJobRepository(getAppDatabase()).findByIdempotencyKey(tenantId, row.idempotency_key);
  return dataResponse(request, job);
}

export const GET = withApiAuth(handleGET);
