import { withApiAuth } from "@/security/api-auth";
import { getInvestorDirectoryRepository } from "@/db/app";
import { handleGetInvestor, handleUpdateInvestor } from "@/workbench/investor-http";
import { getCurrentUser } from "@/workbench/team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleGetInvestor(request, getInvestorDirectoryRepository(), (await params).id);
}

async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleUpdateInvestor(request, getInvestorDirectoryRepository(), getCurrentUser(), (await params).id);
}

export const GET = withApiAuth(handleGET);
export const PATCH = withApiAuth(handlePATCH);
