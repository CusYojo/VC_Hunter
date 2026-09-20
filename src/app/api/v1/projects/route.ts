import { withApiAuth } from "@/security/api-auth";
import { getAppRepository } from "@/db/app";
import { handleGetProjects } from "@/api/project-handlers";
import { handleAdminProject } from "@/workbench/project-admin-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(request: Request) {
  return handleGetProjects(request, getAppRepository());
}

export const GET = withApiAuth(handleGET);
export const POST = withApiAuth((request: Request) => handleAdminProject(request));
