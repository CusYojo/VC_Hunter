import { withApiAuth } from "@/security/api-auth";
import { dataResponse } from "@/api/envelope";
import { getAppDatabase } from "@/db/app";
import { createOperation, getOperationWorkspace } from "@/workbench/business-operations";
import { operationActor, operationError } from "@/workbench/business-operation-http";
import { readOperationInput } from "@/workbench/business-operation-input";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ kind: string }> };
export const GET = withApiAuth(async (request: Request, { params }: Context) => {
  try { const { kind } = await params; return dataResponse(request, getOperationWorkspace(getAppDatabase(), operationActor(), kind, new URL(request.url).searchParams.get("archived") === "1")); }
  catch (error) { return operationError(request, error); }
});
export const POST = withApiAuth(async (request: Request, { params }: Context) => {
  try { const { kind } = await params; const { input, files } = await readOperationInput(request); return dataResponse(request, createOperation(getAppDatabase(), operationActor(), kind, input, request.headers.get("idempotency-key") ?? "", { files }), { status: 201 }); }
  catch (error) { return operationError(request, error); }
});
