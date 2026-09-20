export class OrganizationRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function organizationRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { cache: "no-store", ...options }); }
  catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new OrganizationRequestError("网络连接失败，请稍后重试。", 0);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || !("data" in body)) {
    const message = response.status === 409 ? "资料已被更新，请保留修改内容后重新载入最新资料。"
      : response.status === 403 ? "没有操作权限，请联系组织管理员。"
      : response.status === 401 ? "登录已过期，请重新登录。"
      : body?.error?.message || "服务暂时不可用，请稍后重试。";
    throw new OrganizationRequestError(message, response.status);
  }
  return body.data as T;
}

export function organizationWrite<T>(url: string, method: "POST" | "PATCH", input: unknown) {
  return organizationRequest<T>(url, { method, headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(input) });
}

export const fieldClass = "min-h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 py-2 text-base sm:text-sm text-foreground disabled:cursor-not-allowed disabled:bg-muted";
