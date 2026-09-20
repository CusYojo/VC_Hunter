"use client";

import type { ComponentType, CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bot, BriefcaseBusiness, CalendarDays, CheckSquare2, ChevronDown, ChevronLeft, CircleDollarSign,
  ContactRound, FlaskConical, Home, Landmark, Menu, MoreHorizontal,
  PanelLeftClose, PanelLeftOpen, Search, Settings2, Sparkles, Stamp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { NotificationBell } from "@/components/notification-bell";
import { demoPersonas, getDesktopNavigation, getMobileNavigation, getWorkspaceNavigation, getPrimaryWorkspaceNavigation, type NavigationIcon } from "@/prototype/navigation";
import { dispatchPrototype, usePrototypeState } from "@/prototype/store";
import type { CurrentUser } from "@/workbench/contracts";
import { authRequest } from "@/auth/client";
import type { WorkspaceSearchResult } from "@/workbench/search-contracts";

const icons: Record<NavigationIcon, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  home: Home,
  projects: BriefcaseBusiness,
  research: FlaskConical,
  work: CheckSquare2,
  calendar: CalendarDays,
  approvals: Stamp,
  funds: Landmark,
  finance: CircleDollarSign,
  resources: ContactRound,
  ai: Bot,
  admin: Settings2,
  more: MoreHorizontal,
};

const searchDestinations = [
  { label: "项目 Pipeline", detail: "查看项目阶段与负责人", href: "/projects?view=pipeline", icon: BriefcaseBusiness },
  { label: "待我审批", detail: "立项、IC、合同、费用与付款", href: "/approvals?view=inbox", icon: Stamp },
  { label: "研究报告", detail: "行业研究、知识与技术告警", href: "/research?view=reports", icon: FlaskConical },
  { label: "基金与 LP", detail: "基金概览、LP CRM 与 Portfolio", href: "/funds", icon: Landmark },
  { label: "联系人与专家", detail: "人物、机构和专家资源", href: "/resources", icon: ContactRound },
  { label: "Agent Runs", detail: "查看 AI 任务与人工复核", href: "/ai?view=runs", icon: Bot },
];

function isCurrent(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function GlobalSearch({ open, onOpenChange, authenticated, canManageOrganization }: { open: boolean; onOpenChange: (open: boolean) => void; authenticated: boolean; canManageOrganization: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WorkspaceSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const destinations = authenticated ? getWorkspaceNavigation(canManageOrganization).map((item) => ({ label: item.label, detail: "工作空间", href: item.href, icon: icons[item.icon] })) : searchDestinations;
  const matchingDestinations = destinations.filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => {
    if (!open || !authenticated || !query.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/v1/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message ?? "搜索暂不可用，请稍后重试。");
        if (!controller.signal.aborted) setResults(result.data.items);
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "搜索失败。"); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [authenticated, open, query]);
  function changeQuery(value: string) { setQuery(value); setResults([]); setError(""); setLoading(authenticated && Boolean(value.trim())); }
  function changeOpen(value: boolean) { if (!value) changeQuery(""); onOpenChange(value); }
  function navigate(href: string) { changeOpen(false); router.push(href); }
  const typeLabels = { project: "项目", investor: "机构", person: "人物", technology: "技术", candidate: "待审情报", knowledge: "知识" };
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogContent aria-label="全局搜索" className="top-[18%] max-w-2xl translate-y-0 gap-0 overflow-hidden p-0" showCloseButton>
      <DialogHeader className="sr-only"><DialogTitle>全局搜索</DialogTitle><DialogDescription>搜索项目、机构、人物、知识或功能</DialogDescription></DialogHeader>
      <Command label="搜索项目、机构、人物或功能" shouldFilter={false}>
        <CommandInput role="searchbox" aria-label="搜索项目、机构、人物或功能" placeholder="搜索项目、机构、人物或功能…" className="h-11" autoFocus maxLength={100} value={query} onValueChange={changeQuery} />
        <CommandList className="max-h-[min(26rem,60vh)] p-2">
          {loading && <p role="status" className="px-3 py-4 text-sm text-muted-foreground">正在搜索真实记录…</p>}
          {error && <p role="alert" className="px-3 py-4 text-sm text-destructive">{error}</p>}
          {!loading && !error && <CommandEmpty>未找到结果，请换一个关键词。</CommandEmpty>}
          {results.length > 0 && <CommandGroup heading="搜索结果">{results.map((item) => <CommandItem key={`${item.type}-${item.id}`} value={`${item.type}-${item.id}`} className="min-h-12" onSelect={() => navigate(item.href)}><Search aria-hidden="true" /><span className="grid min-w-0 gap-0.5"><strong>{item.title}</strong><small className="line-clamp-2 text-muted-foreground">{typeLabels[item.type]} · {item.snippet}</small></span></CommandItem>)}</CommandGroup>}
          {matchingDestinations.length > 0 && <CommandGroup heading="快速前往">{matchingDestinations.map((item) => <CommandItem key={item.href} value={`nav-${item.href}`} className="min-h-12" onSelect={() => navigate(item.href)}><item.icon aria-hidden={true} /><span className="grid gap-0.5"><strong>{item.label}</strong><small className="text-muted-foreground">{item.detail}</small></span></CommandItem>)}</CommandGroup>}
        </CommandList>
      </Command>
    </DialogContent>
  </Dialog>;
}

export function AppShell({ children, authenticated = false, user = null, canManageOrganization = false }: { children: ReactNode; authenticated?: boolean; user?: CurrentUser | null; canManageOrganization?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const state = usePrototypeState();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [moreState, setMoreState] = useState<{ pathname: string; open: boolean } | null>(null);
  const navigation = authenticated ? getWorkspaceNavigation(canManageOrganization) : getDesktopNavigation(state.persona);
  const primaryNavigation = getPrimaryWorkspaceNavigation(navigation);
  const secondaryNavigation = navigation.filter(item => !primaryNavigation.some(primary => primary.href === item.href));
  const secondaryActive = secondaryNavigation.some(item => isCurrent(pathname, item.href));
  const moreOpen = moreState?.pathname === pathname ? moreState.open : secondaryActive;


  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (pathname === "/login") return <>{children}</>;
  async function signOut() {
    try { await authRequest("/sign-out", {}); router.replace("/login"); router.refresh(); }
    catch { setSignOutError("退出失败，请稍后重试。"); }
  }
  const shellStyle = { "--shell-sidebar-width": collapsed ? "4.5rem" : "15.5rem" } as CSSProperties;
  const renderNavigation = (items: typeof navigation) => items.map((item) => {
    const Icon = icons[item.icon];
    const active = isCurrent(pathname, item.href);
    return (
      <li key={item.href}>
        <Tooltip>
          <TooltipTrigger render={<Link href={item.href} aria-label={item.label} aria-current={active ? "page" : undefined} onClick={() => setMobileOpen(false)} className={`group/nav relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${active ? "bg-card text-primary ring-1 ring-sidebar-border" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"}`} />}>
            <Icon className={`size-[18px] shrink-0 ${active ? "stroke-[2.25]" : ""}`} aria-hidden={true} />{!collapsed && <span>{item.label}</span>}{active && !collapsed && <span className="ml-auto size-1.5 rounded-full bg-primary" aria-hidden="true" />}
          </TooltipTrigger>
          {collapsed && <TooltipContent side="right">{item.label}</TooltipContent>}
        </Tooltip>
      </li>
    );
  });
  return (
    <TooltipProvider>
      <div className="min-h-dvh bg-background text-foreground" style={shellStyle}>
        <a href="#main-content" className="fixed left-3 top-2 z-[100] -translate-y-16 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:translate-y-0">跳到主要内容</a>
        <header className="fixed inset-x-0 top-0 z-40 flex h-16 items-center border-b border-border bg-card px-3 md:pl-[calc(var(--shell-sidebar-width)+1.25rem)] md:pr-6">
          <Button variant="ghost" size="icon-lg" className="mr-2 md:hidden" aria-label={mobileOpen ? "关闭导航" : "打开导航"} onClick={() => setMobileOpen((value) => !value)}>
            {mobileOpen ? <ChevronLeft aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </Button>
          <button type="button" aria-label="打开全局搜索" onClick={() => setSearchOpen(true)} className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-background px-3.5 text-left text-sm text-muted-foreground transition-[border-color,background-color] hover:border-primary/30 hover:bg-card md:max-w-xl">
            <Search className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">搜索项目、机构、人物或功能</span>
            <kbd className="ml-auto hidden rounded-md border bg-muted/55 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">⌘ K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-2 pl-2">
            {authenticated && <Link href="/settings" aria-label="个人设置" className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-muted"><Settings2 className="size-5" aria-hidden="true" /></Link>}
            <NotificationBell />
            {authenticated ? <div className="flex items-center gap-2"><span className="hidden text-sm sm:inline">{user?.name}</span><Button variant="ghost" onClick={signOut}>退出</Button>{signOutError && <span role="alert" className="text-xs text-red-700">{signOutError}</span>}</div> : <label className="relative">
              <span className="sr-only">演示角色</span>
              <select aria-label="演示角色" value={state.persona} onChange={(event) => dispatchPrototype({ type: "persona.select", persona: event.target.value as typeof state.persona })} className="h-10 max-w-[8.5rem] cursor-pointer appearance-none rounded-lg border border-border bg-card pl-3 pr-8 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring md:max-w-[11rem]">
                {demoPersonas.map((persona) => <option key={persona.id} value={persona.id}>{persona.label}</option>)}
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-xs text-muted-foreground">⌄</span>
            </label>}
          </div>
        </header>

        <aside className={`fixed inset-y-0 left-0 z-50 flex border-r border-sidebar-border bg-sidebar transition-[width,transform] duration-200 motion-reduce:transition-none md:translate-x-0 ${collapsed ? "w-[4.5rem]" : "w-[15.5rem]"} ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-16 items-center gap-3 border-b border-sidebar-border/70 px-4">
              <Link href="/" aria-label="VC Hunter 首页" className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-xs font-bold tracking-wide text-primary-foreground"><span>VC</span></Link>
              {!collapsed && <div className="min-w-0"><strong className="block truncate text-sm font-semibold tracking-tight">VC Hunter</strong><span className="block truncate text-[11px] text-muted-foreground">投资运营 OS</span></div>}
            </div>
            <nav aria-label="业务中心" className="flex-1 overflow-y-auto px-2.5 py-4">
              {!collapsed && <p className="mb-2 px-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/75">工作空间</p>}
              <ul className="grid gap-1">{renderNavigation(primaryNavigation)}</ul>
              {secondaryNavigation.length > 0 && <div className="mt-3 border-t border-sidebar-border/70 pt-3">
                <button type="button" aria-label="更多功能" aria-expanded={moreOpen} aria-controls="sidebar-more-functions"
                  onClick={() => { if (collapsed) setCollapsed(false); setMoreState({ pathname, open: collapsed || !moreOpen }); }}
                  className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${secondaryActive ? "text-primary" : "text-sidebar-foreground"} hover:bg-sidebar-accent`}>
                  <MoreHorizontal className="size-[18px] shrink-0" aria-hidden="true" />
                  {!collapsed && <><span>更多功能</span><ChevronDown className={`ml-auto size-4 transition-transform motion-reduce:transition-none ${moreOpen ? "rotate-180" : ""}`} aria-hidden="true" /></>}
                </button>
                <ul id="sidebar-more-functions" hidden={!moreOpen} className="mt-1 grid gap-1">{moreOpen && renderNavigation(secondaryNavigation)}</ul>
              </div>}
            </nav>
            <div className="border-t border-sidebar-border/70 p-2.5">
              {!collapsed && <div className="mb-2 rounded-lg border border-primary/10 bg-primary/[0.045] px-3 py-2.5"><p className="flex items-center gap-1.5 text-xs font-medium text-foreground"><Sparkles className="size-3.5 text-primary" aria-hidden="true" />{authenticated ? "团队工作空间" : "演示工作区"}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{authenticated ? `${user?.role ?? "请登录"} · 个人账号` : "演示视图，不改变服务端权限"}</p></div>}
              <Button variant="ghost" className="h-11 w-full justify-start gap-3" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "展开侧栏" : "收起侧栏"}>
                {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}{!collapsed && <span>收起侧栏</span>}
              </Button>
            </div>
          </div>
        </aside>
        {mobileOpen && <button type="button" aria-label="关闭导航遮罩" className="fixed inset-0 z-40 cursor-pointer bg-slate-950/30 md:hidden" onClick={() => setMobileOpen(false)} />}

        <main id="main-content" tabIndex={-1} className={`min-h-dvh pt-16 pb-20 transition-[padding] duration-200 motion-reduce:transition-none md:pb-0 ${collapsed ? "md:pl-[4.5rem]" : "md:pl-[15.5rem]"}`}>{children}</main>

        <nav aria-label="移动端导航" className={`fixed inset-x-0 bottom-0 z-30 grid ${authenticated ? "grid-cols-6" : "grid-cols-5"} border-t border-border bg-card px-1 pb-[env(safe-area-inset-bottom)] md:hidden`}>
          {(authenticated ? primaryNavigation : getMobileNavigation()).map((item) => {
            const Icon = icons[item.icon];
            const active = isCurrent(pathname, item.href);
            return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium ${active ? "text-primary" : "text-muted-foreground"}`}><Icon className="size-5" aria-hidden={true} /><span>{item.label}</span></Link>;
          })}
        </nav>
        <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} authenticated={authenticated} canManageOrganization={canManageOrganization} />
      </div>
    </TooltipProvider>
  );
}
