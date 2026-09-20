import { withApiAuth } from "@/security/api-auth";
import { officeRequest } from "@/organization/office-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const PATCH = withApiAuth((request: Request) => officeRequest(request, "profile"));
