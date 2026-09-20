import { timingSafeEqual } from "node:crypto";
import { dataResponse, errorResponse } from "./envelope";
import { listSkillDefinitions } from "@/skills";

/**
 * Skill catalog is public inside the local app. Execution stays fail-closed until
 * inputs can be rebuilt server-side from tenant-scoped, policy-approved evidence IDs.
 */
export async function handleListSkills(request: Request): Promise<Response> {
  return dataResponse(request, { items: listSkillDefinitions() });
}

export async function handleExecuteSkill(request: Request, skillId: string): Promise<Response> {
  if (process.env.ENABLE_SKILL_EXECUTION !== "true") return errorResponse(request, 404, "NOT_FOUND", "Skill 执行入口未启用。");
  if (!listSkillDefinitions().some((skill) => skill.id === skillId)) return errorResponse(request, 404, "NOT_FOUND", "Skill 不存在。");

  const configuredToken = process.env.SKILL_EXECUTION_TOKEN ?? "";
  if (configuredToken.length < 16) return errorResponse(request, 503, "AUTH_REQUIRED", "Skill 执行凭据尚未配置。");
  const suppliedToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!tokensEqual(configuredToken, suppliedToken)) return errorResponse(request, 401, "AUTH_REQUIRED", "Skill 执行凭据无效。");
  if (!originAllowed(request)) return errorResponse(request, 403, "COMPLIANCE_BLOCKED", "请求来源不在允许范围内。");

  return errorResponse(
    request,
    503,
    "COMPLIANCE_BLOCKED",
    "服务端证据政策解析器尚未启用；Skill 只能由受控后台 Workflow 调用。",
  );
}

function tokensEqual(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allowed = new Set((process.env.SKILL_ALLOWED_ORIGINS ?? new URL(request.url).origin).split(",").map((value) => value.trim()).filter(Boolean));
  return allowed.has(origin);
}
