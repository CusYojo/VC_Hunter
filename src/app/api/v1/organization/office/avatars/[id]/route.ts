import { withApiAuth } from "@/security/api-auth";
import { officeAvatarRequest } from "@/organization/office-avatar-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withApiAuth(async (request, { params }: { params: Promise<{ id: string }> }) => officeAvatarRequest(request, "image", (await params).id));
