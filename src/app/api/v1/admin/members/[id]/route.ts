import { withApiAuth } from "@/security/api-auth";
import { organizationRequest } from "@/organization/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const PATCH = withApiAuth(async (request, { params }: { params: Promise<{ id: string }> }) => organizationRequest(request, "update-member", (await params).id));
