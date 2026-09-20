import { withApiAuth } from "@/security/api-auth";
import { officeAvatarRequest } from "@/organization/office-avatar-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const PATCH = withApiAuth(async (request, { params }: { params: Promise<{ id: string }> }) => officeAvatarRequest(request, "review", (await params).id));
