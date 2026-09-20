import { withApiAuth } from "@/security/api-auth";
import { organizationRequest } from "@/organization/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = withApiAuth((request) => organizationRequest(request, "create-department"));
