import { withApiAuth } from "@/security/api-auth";
import { dataResponse, errorResponse } from "@/api/envelope";
import { getAppRepository } from "@/db/app";
import { handleAdminProject } from "@/workbench/project-admin-http";
import { authenticationRequired, identityScope } from "@/security/identity-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const project = getAppRepository().findById((await params).id);
  if (!project) return errorResponse(request, 404, "NOT_FOUND", "项目不存在。");
  const roles = identityScope.getStore()?.roles ?? (authenticationRequired() ? [] : ["investment_manager"]);
  const canViewContacts = roles.some((role) => ["org_admin", "investment_manager", "researcher"].includes(role));
  const visibleProject = canViewContacts || !project.companyIntelligence
    ? project
    : { ...project, companyIntelligence: { ...project.companyIntelligence, contacts: [] } };
  return dataResponse(request, visibleProject);
}

export const GET = withApiAuth(handleGET);
export const PATCH = withApiAuth(async (request: Request, { params }: { params: Promise<{ id: string }> }) => handleAdminProject(request, (await params).id));
