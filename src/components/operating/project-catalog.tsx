import Link from "next/link";
import { CatalogCandidateActions } from "@/components/catalog-candidate-actions";
import { ArrowUpRight, FolderArchive } from "lucide-react";
import { CandidateDiscoveryDetails } from "@/components/candidate-discovery-details";
import { IntelligenceProjectCard } from "@/components/intelligence-project-card";
import { catalogDate, filterProjectCatalog, PROJECT_CATEGORIES, type ProjectCatalogFilters, type ProjectCatalogRow } from "@/workbench/project-catalog";

const control = "min-h-11 w-full min-w-0 rounded-lg border border-border bg-card px-3 text-base text-foreground";
const labelClass = "grid min-w-0 gap-1.5 text-sm font-medium";
export function ProjectCatalog({ rows, filters, error, page = 1, team = [], currentUser = "", canAdmin = false, canReview = false, recentScopeKey }: { rows: ProjectCatalogRow[]; filters: ProjectCatalogFilters; error?: string; page?: number; team?: {id: string; name: string; departmentId?: string | null; departmentName?: string | null}[]; currentUser?: string; canAdmin?: boolean; canReview?: boolean; recentScopeKey?: string }) {
  const visible = filterProjectCatalog(rows, filters);
  const tracks = [...new Set(rows.map(row => row.track))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const owners = [...new Set(rows.flatMap(row => row.owners))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const pageCount = Math.max(1, Math.ceil(visible.length / 40));
  const currentPage = Math.max(1, Math.min(pageCount, page));
  const pageRows = visible.slice((currentPage - 1) * 40, currentPage * 40);
  const pageHref = (target: number) => `/all-projects?${new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter((entry): entry is [string, string] => typeof entry[1] === "string")), page: String(target) })}`;
  return <div className="mx-auto grid w-full min-w-0 max-w-[96rem] gap-4 px-4 py-5 sm:px-6 lg:px-8">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="mb-1 text-sm text-muted-foreground">更多功能 / 项目档案</p><h1 className="flex items-center gap-2 text-3xl font-semibold"><FolderArchive className="size-6 text-primary" aria-hidden="true" />全部项目</h1></div>
      <Link href="/projects" className="inline-flex min-h-11 items-center gap-1 text-base font-medium text-primary">项目管理<ArrowUpRight className="size-4" aria-hidden="true" /></Link>
    </header>
    <p className="text-base leading-6 text-muted-foreground">按最新动态从近到远排列。暂不跟进的项目与历史线索保留在这里，日期以北京时间为准。</p>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}
    <form action="/all-projects" method="get" aria-label="筛选全部项目" className="grid min-w-0 gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 xl:grid-cols-4">
      <label className={labelClass}>搜索项目<input className={control} name="q" defaultValue={filters.q ?? ""} maxLength={200} placeholder="项目名、简介或细分赛道" /></label>
      <label className={labelClass}>项目类别<select className={control} name="category" defaultValue={filters.category ?? "all"}><option value="all">全部类别</option>{Object.entries(PROJECT_CATEGORIES).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
      <label className={labelClass}>赛道<select className={control} name="track" defaultValue={filters.track ?? "all"}><option value="all">全部赛道</option>{tracks.map(track => <option key={track} value={track}>{track}</option>)}</select></label>
      <label className={labelClass}>负责人<select className={control} name="owner" defaultValue={filters.owner ?? "all"}><option value="all">全部负责人</option><option value="unassigned">未分配负责人</option>{owners.map(owner => <option key={owner} value={owner}>{owner}</option>)}</select></label>
      <label className={labelClass}>开始日期<input type="date" className={control} name="from" defaultValue={filters.from ?? ""} /></label>
      <label className={labelClass}>结束日期<input type="date" className={control} name="to" defaultValue={filters.to ?? ""} /></label>
      <div className="flex flex-wrap items-end gap-3 sm:col-span-2"><button className="min-h-11 rounded-lg bg-primary px-5 text-base font-semibold text-primary-foreground" type="submit">应用筛选</button><Link className="inline-flex min-h-11 items-center px-2 text-base text-primary" href="/all-projects">重置筛选</Link><span role="status" className="pb-2 text-base text-muted-foreground">共 {visible.length} 个项目</span></div>
    </form>
    {visible.length === 0 ? <div className="rounded-xl border border-dashed bg-card p-8 text-center"><h2 className="text-lg font-semibold">没有符合筛选条件的项目</h2><p className="mt-2 text-base text-muted-foreground">可调整类别、时间段或负责人后重新查看。</p></div> : <ol aria-label="项目时间线" className="grid gap-3">
      {pageRows.map(row => <li key={`${row.kind}:${row.id}`} data-catalog-id={row.id} className="grid min-w-0 gap-2 sm:grid-cols-[7rem_minmax(0,1fr)]">
        <div className="flex items-center gap-2 py-1 text-sm font-medium text-muted-foreground sm:pt-4"><span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-primary/60" /><time dateTime={row.latestAt ?? undefined}>{catalogDate(row.latestAt)}</time></div>
        {row.intelligenceCandidate ? <IntelligenceProjectCard candidate={row.intelligenceCandidate} canAdmin={canAdmin} canReview={canReview} headingLevel="h2" /> : <article className="min-w-0 rounded-xl border bg-card px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="min-w-0 break-words text-xl font-semibold">{row.kind === "project" ? <Link href={`/projects/${row.id}`} className="text-primary hover:underline">{row.name}</Link> : row.name}</h2><div className="flex flex-wrap gap-2 text-sm"><span className="rounded-full bg-primary/10 px-2.5 py-1 text-primary">{PROJECT_CATEGORIES[row.category]}</span><span className="rounded-full bg-muted px-2.5 py-1">{row.track}</span></div></div>
          <p className="mt-1 text-sm text-muted-foreground">{row.statusLabel}{row.subtrack ? ` · ${row.subtrack}` : ""} · 负责人：{row.owners.join("、") || "未分配"}</p>
          <p className="mt-2 line-clamp-2 break-words text-base leading-6">{row.summary}</p>
          {row.discoveryHref && <Link href={row.discoveryHref} className="mt-2 inline-flex min-h-11 items-center gap-1 text-base font-medium text-primary">在新项目发现中查看<ArrowUpRight className="size-4" aria-hidden="true" /></Link>}
          {row.candidate && <details className="mt-2"><summary className="cursor-pointer py-2 text-base font-medium text-primary">查看线索详情</summary><CandidateDiscoveryDetails candidate={row.candidate} /><CatalogCandidateActions candidate={row.candidate} team={team} currentUser={currentUser} canAdmin={canAdmin} canReview={canReview} recentScopeKey={recentScopeKey} /></details>}
        </article>}
      </li>)}
    </ol>}
    {pageCount > 1 && <nav aria-label="项目分页" className="flex items-center justify-center gap-5 text-base">{currentPage > 1 && <Link className="inline-flex min-h-11 items-center text-primary" href={pageHref(currentPage - 1)}>上一页</Link>}<span>第 {currentPage} / {pageCount} 页</span>{currentPage < pageCount && <Link className="inline-flex min-h-11 items-center text-primary" href={pageHref(currentPage + 1)}>下一页</Link>}</nav>}
  </div>;
}
