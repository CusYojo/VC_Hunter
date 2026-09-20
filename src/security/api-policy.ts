import { isOrganizationRole, type OrganizationRole } from "./roles";

const writers: readonly OrganizationRole[] = ["org_admin", "investment_manager"];
const researchers: readonly OrganizationRole[] = [...writers, "researcher"];
const members: readonly OrganizationRole[] = [...researchers, "viewer", "compliance_reviewer"];
const mutationRules: readonly [RegExp, readonly OrganizationRole[]][] = [
  [/^POST \/api\/v1\/activity\/[^/]+\/lifecycle$/, members],
  [/^POST \/api\/v1\/activity\/[^/]+\/view$/, members],
  [/^DELETE \/api\/v1\/activity\/[^/]+\/comments\/[^/]+$/, members],
  [/^DELETE \/api\/v1\/projects\/[^/]+\/comments\/[^/]+$/, members],
  [/^DELETE \/api\/v1\/projects\/[^/]+\/documents\/[^/]+\/annotations\/[^/]+$/, members],
  [/^POST \/api\/v1\/activity\/[^/]+\/complete-meeting$/, members],
  [/^PATCH \/api\/v1\/organization\/office\/me$/, members],
  [/^PATCH \/api\/v1\/organization\/office\/profile$/, members],
  [/^POST \/api\/v1\/organization\/office\/avatar$/, members],
  [/^PATCH \/api\/v1\/admin\/organization\/office\/layout$/, ["org_admin"]],
  [/^PATCH \/api\/v1\/admin\/organization\/office\/avatars\/[^/]+$/, ["org_admin"]],
  [/^POST \/api\/v1\/activity\/[^/]+\/comments$/, members],
  [/^PATCH \/api\/v1\/activity\/[^/]+\/edit$/, researchers],
  [/^POST \/api\/v1\/projects$/, ["org_admin"]],
  [/^PATCH \/api\/v1\/projects\/[^/]+$/, ["org_admin"]],
  [/^PATCH \/api\/v1\/candidates\/order$/, ["org_admin"]],
  [/^PATCH \/api\/v1\/candidates\/[^/]+$/, ["org_admin"]],
  [/^POST \/api\/v1\/ai\/conversations(?:\/[^/]+\/messages)?$/, members],
  [/^POST \/api\/v1\/projects\/[^/]+\/assistant$/, members],
  [/^POST \/api\/v1\/candidates$/, researchers],
  [/^(PUT|DELETE) \/api\/v1\/settings\/ai$/, members],
  [/^POST \/api\/v1\/settings\/ai\/test$/, members],
  [/^POST \/api\/v1\/ai\/(runs|extract|templates)$/, members],
  [/^DELETE \/api\/v1\/ai\/templates$/, members],
  [/^POST \/api\/v1\/operations\/[^/]+$/, writers],
  [/^PATCH \/api\/v1\/discovery\/schedule$/, ["org_admin"]],
  [/^POST \/api\/v1\/discovery\/items$/, researchers],
  [/^PATCH \/api\/v1\/discovery\/items\/[^/]+$/, ["org_admin"]],
  [/^PATCH \/api\/v1\/discovery\/items\/[^/]+\/review$/, writers],
  [/^POST \/api\/v1\/discovery\/imports\/preview$/, ["org_admin"]],
  [/^POST \/api\/v1\/discovery\/imports\/[^/]+\/commit$/, ["org_admin"]],
  [/^PATCH \/api\/v1\/discovery\/plans$/, ["org_admin"]],
  [/^PATCH \/api\/v1\/operations\/[^/]+\/[^/]+$/, writers],
  [/^PATCH \/api\/v1\/admin\/members\/[^/]+$/, ["org_admin"]],
  [/^POST \/api\/v1\/admin\/departments$/, ["org_admin"]],
  [/^PATCH \/api\/v1\/admin\/departments\/[^/]+$/, ["org_admin"]],
  [/^POST \/api\/v1\/activity$/, researchers],
  [/^POST \/api\/v1\/activity\/[^/]+\/documents$/, researchers],
  [/^PATCH \/api\/v1\/activity\/[^/]+$/, ["org_admin", "investment_manager", "researcher", "viewer", "compliance_reviewer"]],
  [/^POST \/api\/v1\/investors$/, writers],
  [/^PATCH \/api\/v1\/investors\/[^/]+$/, writers],
  [/^POST \/api\/v1\/(discovery|research)\/jobs$/, researchers],
  [/^PATCH \/api\/v1\/candidates\/[^/]+\/review$/, writers],
  [/^PATCH \/api\/v1\/knowledge\/[^/]+\/review$/, writers],
  [/^PATCH \/api\/v1\/notifications\/[^/]+$/, ["org_admin", "investment_manager", "researcher", "viewer", "compliance_reviewer"]],
  [/^PATCH \/api\/v1\/notifications$/, members],
  [/^PATCH \/api\/v1\/projects\/[^/]+\/(assignment|review)$/, writers],
  [/^POST \/api\/v1\/projects\/[^/]+\/(documents|comments|judgments|evidence-request)$/, researchers],
  [/^POST \/api\/v1\/projects\/[^/]+\/documents\/[^/]+\/annotations$/, [...researchers, "compliance_reviewer"]],
  [/^POST \/api\/v1\/projects\/[^/]+\/milestones$/, writers],
  [/^PATCH \/api\/v1\/projects\/[^/]+\/milestones\/[^/]+$/, writers],
  [/^POST \/api\/v1\/projects\/[^/]+\/milestones\/[^/]+\/attachments$/, researchers],
];

/** Single-organization deployment. Membership is verified before this policy. */
export function authorizeApiRequest(method: string, pathname: string, roles: readonly string[]): boolean {
  if (!roles.length || !roles.every(isOrganizationRole)) return false;
  if (pathname.startsWith("/api/v1/admin/") && !roles.includes("org_admin")) return false;
  if (method === "GET" || method === "HEAD") return pathname.startsWith("/api/v1/");
  const rule = mutationRules.find(([pattern]) => pattern.test(`${method} ${pathname}`));
  return Boolean(rule && roles.some((role) => rule[1].includes(role as OrganizationRole)));
}

export function checkMutationOrigin(method: string, headers: Headers, origin: string): boolean {
  return ["GET", "HEAD", "OPTIONS"].includes(method) || headers.get("origin") === new URL(origin).origin;
}

export class RequestRateLimiter {
  private readonly windows = new Map<string, { count: number; resetsAt: number }>();

  allow(userId: string, category: "read" | "write" | "expensive", now = Date.now()): boolean {
    const key = `${userId}:${category}`;
    const previous = this.windows.get(key);
    const window = previous && previous.resetsAt > now ? previous : { count: 0, resetsAt: now + 60_000 };
    const limit = category === "expensive" ? 5 : category === "write" ? 60 : 240;
    if (window.count >= limit) return false;
    this.windows.set(key, { ...window, count: window.count + 1 });
    if (this.windows.size > 10_000) {
      for (const [id, value] of this.windows) if (value.resetsAt <= now) this.windows.delete(id);
    }
    return true;
  }
}
