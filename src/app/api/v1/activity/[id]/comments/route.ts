import { withApiAuth } from "@/security/api-auth";
import { createActivityComment, listActivityComments } from "@/workbench/activity-comment-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export const GET = withApiAuth(async (request: Request, { params }: Context) => listActivityComments(request, (await params).id));
export const POST = withApiAuth(async (request: Request, { params }: Context) => createActivityComment(request, (await params).id));
