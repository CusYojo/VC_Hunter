import { withApiAuth } from "@/security/api-auth";
import { officeAvatarRequest } from "@/organization/office-avatar-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withApiAuth((request) => officeAvatarRequest(request, "latest"));
export const POST = withApiAuth((request) => officeAvatarRequest(request, "upload"));
