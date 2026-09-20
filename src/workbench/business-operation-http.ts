import { errorResponse } from "@/api/envelope";
import { identityScope, authenticationRequired } from "@/security/identity-scope";
import { getCurrentTenantId, getCurrentUser } from "./team";
import type { OperationActor } from "./business-operations";
import { OperationAttachmentError } from "./business-operation-documents";
export function operationActor(): OperationActor {
  const identity = identityScope.getStore();
  if (identity) return { tenantId: identity.tenantId, id: identity.user.id, roles: identity.roles };
  if (authenticationRequired()) throw new Error("身份未验证。");
  return { tenantId: getCurrentTenantId(), id: getCurrentUser().id, roles: ["investment_manager"] };
}
export function operationError(request: Request, error: unknown) {
  if (error instanceof OperationAttachmentError) return errorResponse(request, error.status, "INVALID_ATTACHMENT", error.message);
  if (error instanceof SyntaxError) return errorResponse(request, 400, "INVALID_JSON", "请求格式无效。");
  const message = error instanceof Error ? error.message : "";
  if (message.includes("权限")) return errorResponse(request, 403, "FORBIDDEN", message);
  if (message.startsWith("版本冲突") || message === "幂等键已用于不同请求。") return errorResponse(request, 409, "CONFLICT", message);
  if (["记录不存在。", "记录类型不存在。"].includes(message)) return errorResponse(request, 404, "NOT_FOUND", message);
  const known = ["请检查必填信息、金额、日期和状态。", "登记已付款需填写实际付款日和凭证编号。", "实缴金额不能超过认缴金额。", "幂等键无效。", "更新参数无效。", "基金仍关联未归档记录，请先处理关联记录。", "关联基金不存在或已归档。", "关联项目不存在。", "关联资料前请选择项目。", "关联项目资料不存在。"];
  if (known.includes(message)) return errorResponse(request, 400, "INVALID_RECORD", message);
  console.error("Business operation failed", { type: error instanceof Error ? error.name : "Unknown" });
  return errorResponse(request, 500, "OPERATION_FAILED", "业务记录暂不可用，请稍后重试。");
}
