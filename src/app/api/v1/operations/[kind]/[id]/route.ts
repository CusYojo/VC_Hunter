import { withApiAuth } from "@/security/api-auth";
import { dataResponse } from "@/api/envelope";
import { getAppDatabase } from "@/db/app";
import { updateOperation } from "@/workbench/business-operations";
import { operationActor, operationError } from "@/workbench/business-operation-http";
import { readOperationInput } from "@/workbench/business-operation-input";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const PATCH = withApiAuth(async (request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) => {
  try { const { kind, id } = await params; const { input, files } = await readOperationInput(request); return dataResponse(request, updateOperation(getAppDatabase(), operationActor(), kind, id, input, { files, idempotencyKey: request.headers.get("idempotency-key") ?? undefined })); }
  catch (error) { return operationError(request, error); }
});
