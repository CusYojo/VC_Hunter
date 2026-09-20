import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Bot,
  BriefcaseBusiness,
  CalendarClock,
  CircleAlert,
  Clock3,
  Radar,
  Search,
  Sparkles,
  Upload,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HubPage, HubTabs, StatusBadge } from "@/components/operating/hub-layout";
import type { ProjectsView } from "@/prototype/navigation";

type ProjectItem = {
  id: string;
  name: string;
  legalName: string;
  track: string;
  subtrack?: string | null;
  status: string;
  owner?: string | null;
  owners?: string[];
  urgencyScore: number;
  qualityScore: number;
  evidenceAuthority?: string | null;
  riskFlags: string[];
  latestProgress?: string;
  latestAt?: string;
};

type DiscoveryJobLite = { status: string; createdAt: string };

const tabs = [
  { id: "discovery", label: "新项目发现" },
  { id: "manage", label: "项目管理" },
] as const;

const STAGE_INDEX: Record<string, number> = {
  new: 0,
  researching: 1,
  contacting: 2,
  dd: 3,
  ic: 4,
  invested: 5,
  exited: 6,
  pass: 6,
};

const STAGE_LABEL: Record<string, string> = {
  new: "初筛",
  researching: "研究",
  contacting: "接触",
  dd: "尽调",
  ic: "投决",
  invested: "交割",
  exited: "退出",
  pass: "结束",
};

export function ProjectsCenter({
  view,
  projects,
  allProjects,
  pendingCandidates,
  discoveryJobs = [],
  currentUser = "当前用户",
  filters,
  discoveryWorkspace,
  adminActions,
}: {
  view: ProjectsView;
  projects: ProjectItem[];
  allProjects: ProjectItem[];
  pendingCandidates: number;
  discoveryJobs?: DiscoveryJobLite[];
  currentUser?: string;
  filters: { query: string; track: string; owner: string };
  discoveryWorkspace?: ReactNode;
  adminActions?: ReactNode;
}) {
  const owners = Array.from(new Set(allProjects.flatMap(project => project.owners ?? (project.owner ? [project.owner] : []))));
  const tracks = Array.from(new Set(allProjects.map((project) => project.track)));
  const managedProjects = projects.filter(project => project.status !== "pass");
  const visibleOwnedProjects = managedProjects.filter((project) => (project.owners ?? (project.owner ? [project.owner] : [])).includes(currentUser));
  const otherProjects = managedProjects.filter((project) => !visibleOwnedProjects.some((owned) => owned.id === project.id));
  const activeProjects = allProjects.filter((project) => !["pass", "exited"].includes(project.status));
  const criticalProjects = allProjects.filter((project) => ["dd", "ic"].includes(project.status));
  const activeDiscoveryJobs = discoveryJobs.filter((job) => ["queued", "running"].includes(job.status)).length;
  const latestDiscoveryJob = discoveryJobs.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];

  return (
    <HubPage>
      <header className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="max-w-3xl">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-primary">
              <BriefcaseBusiness className="size-4" aria-hidden="true" />
              投资项目工作台
            </div>
            <h1 className="font-editorial text-3xl font-normal tracking-[-0.03em] sm:text-4xl">项目中心</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              从每日项目发现，到立项、尽调、投决与交割，把负责人、材料和决策记录放在同一条主线上。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {adminActions}
            <Button variant="outline" render={<Link href="/projects?view=discovery" />}>
              <Radar aria-hidden="true" />查看今日发现
            </Button>
            <Button render={<Link href="/projects?view=manage" />}>
              <BriefcaseBusiness aria-hidden="true" />我的项目
            </Button>
          </div>
        </div>
        <div className="border-t border-border bg-muted/35 px-4 py-3 sm:px-6">
          <HubTabs basePath="/projects" tabs={tabs} active={view} />
        </div>
      </header>

      {view === "manage" ? (
        <>
          <section aria-label="项目管理概览" className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
            <SummaryMetric icon={BriefcaseBusiness} label="进行中项目" value={activeProjects.length} detail="覆盖初筛至交割" />
            <SummaryMetric icon={CircleAlert} label="尽调 / 投决" value={criticalProjects.length} detail="需要持续跟进" />
            <SummaryMetric icon={Users} label="我的项目" value={visibleOwnedProjects.length} detail={`当前身份：${currentUser}`} />
          </section>

          <section className="grid gap-4" aria-labelledby="owned-projects-title">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 id="owned-projects-title" className="text-xl font-semibold tracking-tight">我负责的项目</h2>
                <p className="mt-1 text-sm text-muted-foreground">先处理自己的项目；卡片展示当前阶段和最近一条推进记录。</p>
              </div>
              <Button variant="outline" render={<Link href="/work" />}>查看全部待办<ArrowUpRight aria-hidden="true" /></Button>
            </div>
            {visibleOwnedProjects.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {visibleOwnedProjects.map((project) => <ProjectCard key={project.id} project={project} emphasized />)}
              </div>
            ) : (
              <EmptyProjects />
            )}
          </section>

          <section className="grid gap-4" aria-labelledby="all-projects-title">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 id="all-projects-title" className="text-xl font-semibold tracking-tight">团队项目</h2>
                <p className="mt-1 text-sm text-muted-foreground">按项目、赛道或负责人快速筛选。</p>
              </div>
              <ProjectFilters filters={filters} tracks={tracks} owners={owners} />
            </div>
            {otherProjects.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {otherProjects.map((project) => <ProjectCard key={project.id} project={project} />)}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">当前筛选下没有其他团队项目。</p>
            )}
          </section>
        </>
      ) : (
        <section className="grid min-w-0 gap-5" aria-labelledby="new-projects-title">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
            <Card className="overflow-hidden border-primary/25 py-0 shadow-none">
              <CardContent className="grid min-h-52 gap-6 p-5 sm:p-6 md:grid-cols-[auto_minmax(0,1fr)] md:items-start">
                <div className="grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground">
                  <Sparkles className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={activeDiscoveryJobs > 0 ? "border-sky-200 bg-sky-50 text-sky-800" : "border-border bg-muted text-muted-foreground"}>{activeDiscoveryJobs > 0 ? `${activeDiscoveryJobs} 个任务运行中` : "等待后台调度"}</Badge>
                    <span className="text-xs text-muted-foreground">每日自动搜索</span>
                  </div>
                  <h2 id="new-projects-title" className="mt-4 text-2xl font-semibold tracking-tight">今日新项目</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    AI 每日整理融资、技术、客户、招投标与人才信号，人工上传的线索也会进入同一复核区。
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <Button render={<a href="#new-project-list" />}><Radar aria-hidden="true" />查看 {pendingCandidates} 个候选</Button>
                    <Button variant="outline" render={<a href="#manual-discovery" />}><Upload aria-hidden="true" />人工上传</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="py-0 shadow-none">
              <CardContent className="grid h-full content-between gap-5 p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">后台搜索调度</p>
                    <p className="mt-1 text-xs text-muted-foreground">每天 10:00、14:00 · 北京时间</p>
                  </div>
                  <span className="grid size-10 place-items-center rounded-lg bg-muted"><Bot className="size-5 text-primary" aria-hidden="true" /></span>
                </div>
                <div>
                  <strong className="text-2xl font-semibold">{activeDiscoveryJobs > 0 ? "正在搜索" : "等待下一轮"}</strong>
                  <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="size-4" aria-hidden="true" />{latestDiscoveryJob ? `最近任务：${formatDateTime(latestDiscoveryJob.createdAt)}` : "暂无任务记录"}</div>
                </div>
              </CardContent>
            </Card>
          </div>
          <div id="new-project-list" className="min-w-0">{discoveryWorkspace}</div>
        </section>
      )}
    </HubPage>
  );
}

function SummaryMetric({ icon: Icon, label, value, detail }: { icon: typeof BriefcaseBusiness; label: string; value: number; detail: string }) {
  return (
    <article className="flex min-h-28 items-center gap-4 bg-card p-4 sm:p-5">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/[0.07] text-primary"><Icon className="size-5" aria-hidden="true" /></span>
      <div><span className="text-xs font-medium text-muted-foreground">{label}</span><div className="mt-1 flex items-baseline gap-2"><strong className="text-2xl tabular-nums">{value}</strong><small className="text-xs text-muted-foreground">{detail}</small></div></div>
    </article>
  );
}

function ProjectCard({ project, emphasized = false }: { project: ProjectItem; emphasized?: boolean }) {
  const progress = project.status === "pass" ? 0 : Math.max(12, Math.round(((STAGE_INDEX[project.status] ?? 0) + 1) / 7 * 100));
  const latestDate = project.latestAt ? formatDate(project.latestAt) : "暂无时间";
  return (
    <article className={`group relative flex min-w-0 flex-col rounded-xl border bg-card p-4 transition-[border-color,background-color] duration-200 motion-reduce:transition-none ${emphasized ? "border-primary/30" : "border-border hover:border-primary/35"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-lg font-semibold leading-6 tracking-tight">{project.name}</h3>
          <p className="mt-1 truncate text-sm text-muted-foreground" title={project.subtrack || project.legalName}>{project.subtrack || project.legalName}</p>
        </div>
        <div className="flex max-w-[52%] shrink-0 flex-wrap justify-end gap-1 [&>[data-slot=badge]]:h-6 [&>[data-slot=badge]]:text-sm"><StatusBadge value={project.status} /><Badge variant="secondary" className="max-w-full" title={project.track}><span className="truncate">{project.track}</span></Badge>{project.riskFlags.length > 0 && <span aria-label={`${project.riskFlags.length} 项风险`} className="grid size-6 shrink-0 place-items-center rounded-md bg-red-50 text-red-700"><CircleAlert className="size-4" aria-hidden="true" /></span>}</div>
      </div>
      <div className="mt-3">
        <div className="flex items-center justify-between gap-2 text-sm"><span className="font-medium">当前：{STAGE_LABEL[project.status] ?? project.status}</span><span className="font-mono tabular-nums text-muted-foreground">{progress}%</span></div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-label={`项目流程完成 ${progress}%`} role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span className="block h-full rounded-full bg-primary" style={{ width: `${progress}%` }} /></div>
      </div>
      <div className="mt-3 border-l-2 border-primary/30 pl-2.5">
        <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground"><CalendarClock className="size-3.5" aria-hidden="true" />最新进度 · {latestDate}</div>
        <p className="mt-1 line-clamp-2 text-base leading-6">{project.latestProgress || "暂无推进记录"}</p>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/60 pt-1">
        <span className="min-w-0 flex-1 break-words text-sm text-muted-foreground">负责人：{(project.owners ?? (project.owner ? [project.owner] : [])).join("、") || "待分配"}</span>
        <Link href={`/projects/${project.id}`} aria-label={`查看${project.name}项目`} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-primary transition-colors hover:bg-primary/[0.06]">进入项目<ArrowUpRight className="size-4" aria-hidden="true" /></Link>
      </div>
    </article>
  );
}

function ProjectFilters({ filters, tracks, owners }: { filters: { query: string; track: string; owner: string }; tracks: string[]; owners: string[] }) {
  return (
    <form method="get" className="grid gap-2 lg:grid-cols-[minmax(11rem,1fr)_9rem_9rem_auto]">
      <input type="hidden" name="view" value="manage" />
      <label className="relative">
        <span className="sr-only">搜索项目</span>
        <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" aria-hidden="true" />
        <input name="query" defaultValue={filters.query} placeholder="搜索项目或子赛道" className="h-11 w-full rounded-lg border bg-card pl-9 pr-3 text-sm" />
      </label>
      <label><span className="sr-only">筛选赛道</span><select name="track" defaultValue={filters.track} className="h-11 w-full cursor-pointer rounded-lg border bg-card px-3 text-sm"><option value="all">全部赛道</option>{tracks.map((track) => <option key={track}>{track}</option>)}</select></label>
      <label><span className="sr-only">筛选负责人</span><select name="owner" defaultValue={filters.owner} className="h-11 w-full cursor-pointer rounded-lg border bg-card px-3 text-sm"><option value="all">全部负责人</option><option value="unassigned">待分配</option>{owners.map((owner) => <option key={owner}>{owner}</option>)}</select></label>
      <Button type="submit" variant="outline">筛选</Button>
    </form>
  );
}

function EmptyProjects() {
  return (
    <div className="grid min-h-48 place-items-center rounded-xl border border-dashed border-border bg-card p-6 text-center">
      <div><BriefcaseBusiness className="mx-auto size-7 text-muted-foreground" aria-hidden="true" /><h3 className="mt-3 font-semibold">还没有负责的项目</h3><p className="mt-1 text-sm text-muted-foreground">从新项目发现中加入感兴趣的项目，或等待管理者分发。</p></div>
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: "Asia/Shanghai" }).format(date);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" }).format(date);
}
