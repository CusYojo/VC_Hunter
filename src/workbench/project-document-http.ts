import { commentDeletionError } from "./comment-deletion";
import { errorResponse } from "@/api/envelope";
import { authenticationRequired, identityScope } from "@/security/identity-scope";
import { getCurrentUser } from "./team";
import { mappedError } from "./http";
import type { DocumentActor } from "./project-document-annotations";

export function currentDocumentActor(): DocumentActor {
  const user = getCurrentUser();
  const roles = identityScope.getStore()?.roles ?? (authenticationRequired() ? [] : ["investment_manager"]);
  return { id: user.id, name: user.name, roles };
}
export function projectDocumentError(request: Request, error: unknown, fallback: string) {
  const deletion = commentDeletionError(request, error);
  if (deletion) return deletion;
  const message = error instanceof Error ? error.message : "";
  if (["没有批注权限。", "没有审核权限。"].includes(message)) return errorResponse(request, 403, "FORBIDDEN", message);
  if (message === "资料文件不可用。") return errorResponse(request, 404, "DOCUMENT_UNAVAILABLE", "资料文件暂不可用，请联系上传人。");
  if (["幂等键无效。", "批注参数无效。", "只能回复当前资料的一级批注。"].includes(message)) return errorResponse(request, 400, "ANNOTATION_REJECTED", message);
  return mappedError(request, error, "DOCUMENT_REQUEST_FAILED", fallback);
}
