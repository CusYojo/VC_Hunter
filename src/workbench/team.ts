import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CurrentUser, TeamMember } from "./contracts";
import { currentUserSchema, teamMemberSchema } from "./contracts";
import { authenticationRequired, identityScope } from "@/security/identity-scope";
import { getAuthService } from "@/auth/server";

const DEFAULT_MEMBERS: readonly TeamMember[] = [
  { id: "user-demo", name: "示例经理", role: "投资经理", tracks: ["AI", "半导体"], subtracks: ["基础模型", "先进封装"], currentLoad: 3 },
  { id: "user-linchuan", name: "林川", role: "投资经理", tracks: ["具身智能", "新材料"], subtracks: ["机器人本体", "先进复材"], currentLoad: 2 },
  { id: "user-zhouning", name: "周宁", role: "投资经理", tracks: ["商业航天", "核聚变", "生物医药"], subtracks: ["卫星制造", "聚变工程", "创新药"], currentLoad: 2 },
];

const TENANT_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function loadTeamMembers(path?: string): TeamMember[] {
  if (path === undefined && authenticationRequired()) {
    const { members, departments } = getAuthService().organization.directory(getCurrentTenantId());
    if (members.length > 0) {
      return members.filter((member) => member.active && member.accountId && !member.isPlaceholder)
        .map((member) => ({ id: member.id, name: member.name, role: member.title || "成员", tracks: [], subtracks: [], currentLoad: 0, assignmentProfileKnown: false, departmentId: member.departmentId, departmentName: departments.find(department => department.id === member.departmentId)?.name ?? null }));
    }
  }
  const configPath = path ?? process.env.VC_HUNTER_TEAM_CONFIG ?? resolve(process.cwd(), ".data/team.json");
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
    return teamMemberSchema.array().parse(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (authenticationRequired()) throw new Error("必须配置真实团队成员配置，不能使用演示成员。");
    return DEFAULT_MEMBERS.map((member) => ({ ...member, tracks: [...member.tracks], subtracks: [...member.subtracks] }));
  }
}

export function getCurrentUser(members?: TeamMember[]): CurrentUser {
  const identity = identityScope.getStore();
  if (identity) return identity.user;
  if (authenticationRequired()) throw new Error("必须通过已验证的个人会话访问。");
  const availableMembers = members ?? loadTeamMembers();
  const selected = availableMembers.find((member) => member.id === process.env.VC_HUNTER_CURRENT_USER_ID) ?? availableMembers[0];
  if (!selected) throw new Error("团队成员配置为空。");
  return currentUserSchema.parse({ id: selected.id, name: selected.name, role: selected.role, capabilities: ["discover", "review", "research", "assign", "knowledge.review"] });
}

export function getCurrentTenantId(): string {
  const identity = identityScope.getStore();
  if (identity) return identity.tenantId;
  if (authenticationRequired() && !process.env.VC_HUNTER_CURRENT_TENANT_ID) throw new Error("必须配置工作空间。");
  const tenantId = process.env.VC_HUNTER_CURRENT_TENANT_ID ?? "demo";
  if (!TENANT_IDENTIFIER_PATTERN.test(tenantId)) throw new Error("服务端租户配置无效。");
  return tenantId;
}

type TeamCandidate = Omit<TeamMember, "tracks" | "subtracks"> & { readonly tracks: readonly TeamMember["tracks"][number][]; readonly subtracks: readonly string[] };

export function suggestOwner<T extends TeamCandidate>(members: readonly T[], project: { track: string; subtrack: string }): T | undefined {
  return members.filter((member) => member.assignmentProfileKnown !== false).sort((left, right) => {
    const score = (member: T) => (member.tracks.includes(project.track as never) ? 100 : 0) + (member.subtracks.includes(project.subtrack) ? 40 : 0) - member.currentLoad * 5;
    return score(right) - score(left) || left.currentLoad - right.currentLoad || left.id.localeCompare(right.id);
  })[0];
}
