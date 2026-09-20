import { withApiAuth } from "@/security/api-auth";
import { getInvestorDirectoryRepository } from "@/db/app";
import { handleCreateInvestor, handleListInvestors } from "@/workbench/investor-http";
import { getCurrentUser } from "@/workbench/team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handleGET(request: Request) {
  return handleListInvestors(request, getInvestorDirectoryRepository());
}

function handlePOST(request: Request) {
  return handleCreateInvestor(request, getInvestorDirectoryRepository(), getCurrentUser());
}

export const GET = withApiAuth(handleGET);
export const POST = withApiAuth(handlePOST);
