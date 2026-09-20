import { errorResponse } from "@/api/envelope";
import { identityScope } from "@/security/identity-scope";

/** Admin authority comes exclusively from the verified request identity. */
export function isCommentAdministrator(actorId: string): boolean {
  const identity = identityScope.getStore();
  return identity?.user.id === actorId && identity.roles.includes("org_admin");
}
export function canDeleteComment(authorId: string, actorId: string | undefined): boolean {
  return Boolean(actorId && (authorId === actorId || isCommentAdministrator(actorId)));
}
export function commentDeletionError(request: Request, error: unknown): Response | undefined {
  const message = error instanceof Error ? error.message : "";
  if (message === "没有删除评论权限。" || message === "正式审核记录不能删除。") return errorResponse(request, 403, "FORBIDDEN", message);
  if (message === "评论不存在。") return errorResponse(request, 404, "NOT_FOUND", message);
}
