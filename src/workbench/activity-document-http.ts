import { ApprovalLifecycleError } from "./approval-lifecycle";
import { z } from "zod";
import { errorResponse } from "@/api/envelope";
import { mappedError } from "./http";

export function activityDocumentError(request: Request, error: unknown, fallback: string) {
  if (error instanceof ApprovalLifecycleError) return errorResponse(request, error.status, error.code, error.message);
  if (error instanceof RangeError) return errorResponse(request, 413, "PAYLOAD_TOO_LARGE", "本次附件总大小不能超过 20 MB。");
  if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError) return errorResponse(request, 400, "SCHEMA_INVALID", "请检查事项、成员、日期和附件参数。");
  const message = error instanceof Error ? error.message : "";
  if (message === "没有上传此事项资料的权限。") return errorResponse(request, 403, "FORBIDDEN", message);
  if (["审批资料不存在。", "事项资料不存在。"].includes(message)) return errorResponse(request, 404, "NOT_FOUND", message);
  if (message === "版本冲突：请刷新后重试。" || message === "幂等键已用于其他内容。") return errorResponse(request, 409, "CONFLICT", message);
  if (["幂等键无效。", "事项版本无效。", "文件名无效。", "仅审批事项支持上传资料。", "审批已处理，不能继续上传资料。", "事项已处理，不能继续添加资料。", "最多上传 10 个文件。", "成员不存在。", "项目不存在。", "审批人不能包含申请人。", "审批需要指定另一位审核人。"].includes(message)) return errorResponse(request, 400, "DOCUMENT_REJECTED", message);
  if (["本次附件总大小不能超过 20 MB。", "单文件不能超过 20 MB。"].includes(message)) return errorResponse(request, 413, "FILE_TOO_LARGE", message);
  if (message === "资料文件不可用。") return errorResponse(request, 404, "DOCUMENT_UNAVAILABLE", "原始资料暂不可用。");
  return mappedError(request, error, "DOCUMENT_REJECTED", fallback);
}
