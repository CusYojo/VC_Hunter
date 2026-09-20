import { withApiAuth } from "@/security/api-auth";
import { organizationRequest } from "@/organization/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withApiAuth((request) => organizationRequest(request, "directory"));
