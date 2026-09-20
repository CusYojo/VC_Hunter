import type { DemoPersona } from "@/prototype/contracts";

export type NavigationIcon = "home" | "projects" | "research" | "work" | "calendar" | "approvals" | "funds" | "finance" | "resources" | "ai" | "admin" | "more";
export type NavigationItem = { href: string; label: string; shortLabel?: string; icon: NavigationIcon };

export function getWorkspaceNavigation(canManageOrganization = false): NavigationItem[] {
  return [
    { href: "/", label: "工作台", icon: "home" },
    { href: "/discover", label: "新项目发现", icon: "research" },
    { href: "/all-projects", label: "全部项目", icon: "projects" },
    { href: "/projects", label: "项目管理", icon: "projects" },
    { href: "/investors", label: "机构追踪", icon: "funds" },
    { href: "/work", label: "我的待办", icon: "work" },
    { href: "/calendar", label: "日程表", icon: "calendar" },
    { href: "/approvals", label: "资料审批", icon: "approvals" },
    { href: "/knowledge", label: "项目知识库", icon: "resources" },
    { href: "/research", label: "研究中心", icon: "research" },
    { href: "/funds", label: "基金中心", icon: "funds" },
    { href: "/finance", label: "财务中心", icon: "finance" },
    { href: "/resources", label: "资源中心", icon: "resources" },
    { href: "/ai", label: "AI 工作台", icon: "ai" },
    { href: "/settings", label: "个人设置", icon: "admin" },
    { href: "/organization", label: "组织架构", icon: "resources" },
    ...(canManageOrganization ? [{ href: "/admin", label: "人员管理", icon: "admin" as const }] : []),
  ];
}

const primaryWorkspaceRoutes = ["/", "/projects", "/work", "/calendar", "/approvals", "/ai"] as const;

export function getPrimaryWorkspaceNavigation(navigation: readonly NavigationItem[]): NavigationItem[] {
  return primaryWorkspaceRoutes.flatMap(href => navigation.filter(item => item.href === href));
}

export const demoPersonas: ReadonlyArray<{ id: DemoPersona; label: string; shortLabel: string; isDefault?: boolean }> = [
  { id: "super_admin", label: "超级管理员", shortLabel: "管理员" },
  { id: "partner", label: "Partner / 合伙人", shortLabel: "Partner" },
  { id: "investment_director", label: "投资总监", shortLabel: "投资总监" },
  { id: "investment_manager", label: "投资经理", shortLabel: "投资经理", isDefault: true },
  { id: "researcher", label: "研究员", shortLabel: "研究员" },
  { id: "finance", label: "财务", shortLabel: "财务" },
  { id: "legal_compliance", label: "法务 / 合规", shortLabel: "法务" },
  { id: "hr_admin", label: "人力 / 行政", shortLabel: "行政" },
  { id: "viewer", label: "只读访客", shortLabel: "访客" },
  { id: "external_advisor", label: "外部顾问", shortLabel: "顾问" },
];

const desktopNavigation: ReadonlyArray<NavigationItem> = [
  { href: "/", label: "今日工作台", icon: "home" },
  { href: "/projects", label: "项目中心", icon: "projects" },
  { href: "/research", label: "研究中心", icon: "research" },
  { href: "/work", label: "协作中心", icon: "work" },
  { href: "/approvals", label: "审批中心", icon: "approvals" },
  { href: "/funds", label: "基金中心", icon: "funds" },
  { href: "/finance", label: "财务中心", icon: "finance" },
  { href: "/resources", label: "资源中心", icon: "resources" },
  { href: "/ai", label: "AI 工作台", icon: "ai" },
  { href: "/admin", label: "系统管理", icon: "admin" },
];

const priorityByPersona: Partial<Record<DemoPersona, ReadonlyArray<string>>> = {
  finance: ["/finance", "/approvals", "/funds"],
  legal_compliance: ["/approvals", "/finance", "/projects"],
  partner: ["/approvals", "/projects", "/funds"],
  investment_director: ["/projects", "/approvals", "/work"],
  researcher: ["/research", "/projects", "/ai"],
  hr_admin: ["/work", "/approvals", "/resources"],
  super_admin: ["/admin", "/ai", "/work"],
};

export function getDesktopNavigation(persona: DemoPersona): NavigationItem[] {
  const priorities = priorityByPersona[persona] ?? ["/projects", "/work", "/research"];
  const home = desktopNavigation[0];
  const remaining = desktopNavigation.slice(1);
  return [home, ...remaining].sort((left, right) => {
    if (left.href === "/") return -1;
    if (right.href === "/") return 1;
    const leftIndex = priorities.indexOf(left.href);
    const rightIndex = priorities.indexOf(right.href);
    if (leftIndex === -1 && rightIndex === -1) return 0;
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });
}

export function getMobileNavigation(): NavigationItem[] {
  return [
    { href: "/", label: "首页", icon: "home" },
    { href: "/projects", label: "项目", icon: "projects" },
    { href: "/work", label: "任务", icon: "work" },
    { href: "/approvals", label: "审批", icon: "approvals" },
    { href: "/more", label: "更多", icon: "more" },
  ];
}

export type ProjectsView = "manage" | "discovery";
export function getProjectsView(value: string | null): ProjectsView {
  return value === "discovery" ? "discovery" : "manage";
}

type DemoAction = "approve_investment" | "edit_project" | "review_contract" | "complete_payment" | "manage_workflow";
const allowedActions: Partial<Record<DemoPersona, ReadonlyArray<DemoAction>>> = {
  super_admin: ["edit_project", "manage_workflow"],
  partner: ["approve_investment", "edit_project"],
  investment_director: ["approve_investment", "edit_project"],
  investment_manager: ["edit_project"],
  legal_compliance: ["review_contract"],
  finance: ["complete_payment"],
};

export function isDemoActionVisible(persona: DemoPersona, action: DemoAction): boolean {
  return allowedActions[persona]?.includes(action) ?? false;
}
