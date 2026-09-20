import { withApiAuth } from "@/security/api-auth";
import { readActivityCommentDocument } from "@/workbench/activity-comment-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withApiAuth(async (request: Request, { params }: { params: Promise<{ id: string; commentId: string; documentId: string }> }) => readActivityCommentDocument(request, await params));
