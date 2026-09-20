"use client";

const messages: Record<string, string> = {
  INVALID_USERNAME_OR_PASSWORD: "账号或密码不正确，请重新输入。",
  INVALID_USERNAME: "账号格式不正确，请使用汉字、字母、数字、下划线或点。",
  ACCOUNT_TEMPORARILY_LOCKED: "尝试次数过多，请稍后重试。",
  INVALID_PASSWORD: "密码不正确，请重新输入。",
};

export async function authRequest<T = Record<string, unknown>>(path: string, body: object): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api/auth${path}`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
  catch { throw new Error("网络连接失败，请稍后重试。"); }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(response.status === 429 ? "尝试次数过多，请稍后重试。" : messages[payload.code] || "操作未完成，请重试或联系管理员。");
  return payload as T;
}
