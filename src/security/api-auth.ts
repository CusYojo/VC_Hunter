import { errorResponse } from "@/api/envelope";
import { authenticationRequired, identityScope } from "./identity-scope";
import { resolveWorkspaceIdentity } from "./workspace-session";
import { authorizeApiRequest, checkMutationOrigin, RequestRateLimiter } from "./api-policy";
import { rejectSecurityOverrideHeaders } from "./request-context";

const limiter = new RequestRateLimiter();
type Handler<Args extends unknown[]> = (request: Request, ...args: Args) => Response | Promise<Response>;

export function withApiAuth<Args extends unknown[]>(handler: Handler<Args>): Handler<Args> {
  return async (request, ...args) => {
    if (!authenticationRequired()) return handler(request, ...args);
    try {
      rejectSecurityOverrideHeaders(request.headers);
    } catch {
      return errorResponse(request, 400, "SECURITY_CONTEXT_OVERRIDE", "禁止指定身份、租户或角色。");
    }
    try {
      const identity = await resolveWorkspaceIdentity(request.headers);
      if (!identity) return errorResponse(request, 401, "AUTH_REQUIRED", "请使用账号和密码登录。");
      const pathname = new URL(request.url).pathname;
      if (!authorizeApiRequest(request.method, pathname, identity.roles)) return errorResponse(request, 403, "FORBIDDEN", "当前账号无此操作权限。");
      const origin = process.env.BETTER_AUTH_URL;
      if (!origin || !checkMutationOrigin(request.method, request.headers, origin)) return errorResponse(request, 403, "ORIGIN_REJECTED", "请求来源无效，请从本站提交。");
      const category = request.method === "GET" ? "read" : /\/(jobs|documents|runs|extract|assistant|messages)$/.test(pathname) || pathname.startsWith("/api/v1/discovery/imports/") || pathname === "/api/v1/discovery/imports/preview" || pathname === "/api/v1/settings/ai/test" ? "expensive" : "write";
      if (!limiter.allow(identity.accountId, category)) return errorResponse(request, 429, "RATE_LIMITED", "操作过于频繁，请稍后重试。");
      const contentLength = request.headers.get("content-length");
      if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > 21 * 1024 * 1024)) return errorResponse(request, 413, "PAYLOAD_TOO_LARGE", "请求内容超过限制。");
      const response = await identityScope.run(identity, () => handler(request, ...args));
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    } catch (error) {
      console.error("Protected request failed", { type: error instanceof Error ? error.name : "Unknown" });
      return errorResponse(request, 500, "INTERNAL_ERROR", "服务暂时不可用，请稍后重试。");
    }
  };
}
