import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, ExternalLink, FileCheck2, Users } from "lucide-react";
import type { InvestorDetail } from "@/repositories/investor-directory";
import type { PersonSummary } from "@/domain/types";
import { Badge } from "@/components/ui/badge";
import { HubPage } from "@/components/operating/hub-layout";
import { InvestorProfileEditor } from "./investor-profile-editor";
import { INSTITUTION_LABELS, INVESTOR_PRIORITY_LABELS, INVESTOR_STATUS_LABELS, publicSourceUrl } from "./investor-fields";

export function InvestorProfile({ investor, people, canEdit }: { investor: InvestorDetail; people: PersonSummary[]; canEdit: boolean }) {
  const recentExamples = Object.entries(investor.extra).filter(([key]) => key.startsWith("原始列:最近投资项目"));
  return <HubPage>
    <Link href="/investors" className="inline-flex min-h-11 w-fit items-center gap-2 text-sm text-muted-foreground hover:text-primary"><ArrowLeft className="size-4" aria-hidden="true" />返回机构追踪</Link>
    <header className="flex flex-wrap items-start gap-4 rounded-lg border border-border bg-card p-5 sm:p-6">
      <span className="grid size-12 place-items-center rounded-lg bg-primary/[0.07] text-primary"><Building2 className="size-6" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1"><div className="mb-2 flex flex-wrap gap-2"><Badge variant="outline">机构档案</Badge><Badge variant="outline" className="border-primary/20 text-primary">{INVESTOR_PRIORITY_LABELS[investor.priority]}</Badge><Badge variant="secondary">{INVESTOR_STATUS_LABELS[investor.status]}</Badge></div>
        <h1 className="text-3xl font-semibold tracking-tight">{investor.name}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{INSTITUTION_LABELS[investor.institutionType]} · {investor.headquarters || "地区未录入"}{investor.englishName ? ` · ${investor.englishName}` : ""}</p>
      </div>
      <p className="text-xs leading-6 text-muted-foreground">档案版本 v{investor.version}<br />更新：{investor.updatedAt?.slice(0, 10) || "暂无更新记录"}</p>
    </header>

    {canEdit && <InvestorProfileEditor key={`${investor.id}:${investor.version}`} investor={investor} />}
    <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,.48fr)]">
      <div className="grid min-w-0 gap-5">
        <ProfileSection title="机构概况">
          <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            <ProfileField label="公开管理规模 / 体系规模" value={investor.fundSize?.text} />
            <ProfileField label="原始机构类型" value={investor.extra["原始列:机构类型"] || INSTITUTION_LABELS[investor.institutionType]} />
            <ProfileField label="关注赛道" value={investor.focusTracks.join("、")} />
            <ProfileField label="原始赛道" value={investor.extra["原始列:核心赛道"]} />
            <ProfileField label="投资阶段" value={investor.stageFocus.join("、")} />
            <ProfileField label="细分方向" value={investor.subtracks.join("、")} />
            <ProfileField label="投资风格" value={investor.investmentStyle} />
            <ProfileField label="别名 / 曾用名" value={investor.aliases.join("、")} />
          </dl>
          <div className="mt-5 border-t border-border pt-5"><p className="text-xs text-muted-foreground">投资逻辑</p><p className="mt-2 whitespace-pre-wrap text-sm leading-7">{investor.thesis || "未录入"}</p></div>
          {investor.fundSize?.source && <p className="mt-3 break-words text-xs text-muted-foreground">规模口径来源：{investor.fundSize.source}</p>}
        </ProfileSection>

        <ProfileSection title="核心成员与合伙人" icon={<Users className="size-4 text-primary" aria-hidden="true" />}>
          <p className="mb-4 text-xs leading-6 text-muted-foreground">档案成员与已有的人物库记录分别展示；不根据同名自动关联。</p>
          {investor.keyPeople.length ? <div className="grid gap-3 sm:grid-cols-2">{investor.keyPeople.map((person, index) => <article key={`${person.name}:${index}`} className="rounded-lg border border-border p-3"><h3 className="font-medium">{person.name}</h3><p className="mt-1 text-sm text-muted-foreground">{person.title || "职务未录入"}</p>{person.focusTracks?.length ? <p className="mt-2 text-xs text-muted-foreground">{person.focusTracks.join("、")}</p> : null}</article>)}</div> : <Empty text="暂无核心成员档案" />}
          {people.length > 0 && <div className="mt-4 border-t border-border pt-4"><h3 className="mb-3 text-sm font-medium">人物库 · 当前机构精确匹配</h3><div className="flex flex-wrap gap-3">{people.map((person) => <Link key={person.id} href={`/people/${encodeURIComponent(person.id)}`} className="rounded-md border border-border p-3 text-sm hover:border-primary/40"><span className="text-primary">{person.name}</span><span className="ml-2 text-muted-foreground">{person.currentTitle || "职务未录入"}</span></Link>)}</div></div>}
        </ProfileSection>

        <ProfileSection title="公开投资示例">
          <p className="mb-4 text-xs leading-6 text-muted-foreground">以下是源表公开示例和机构档案案例，不等同于已核验投资事件，不自动创建项目。</p>
          {recentExamples.length ? recentExamples.map(([key, value]) => <div key={key} className="mb-4 rounded-lg bg-muted/55 p-4"><p className="text-xs text-muted-foreground">{key.replace("原始列:", "")}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-7">{value || "未录入"}</p></div>) : <Empty text="暂无近期公开投资示例" />}
          <h3 className="mb-2 mt-4 text-sm font-medium">明星 / 代表项目</h3>
          {investor.extra["原始列:明星/代表项目"] ? <p className="mb-3 text-sm leading-7">{investor.extra["原始列:明星/代表项目"]}</p> : investor.portfolioSample.length ? <div className="flex flex-wrap gap-2">{investor.portfolioSample.map((sample, index) => <Badge key={`${sample.company}:${index}`} variant="secondary">{sample.company}{sample.year ? ` · ${sample.year}` : ""}{sample.round ? ` · ${sample.round}` : ""}</Badge>)}</div> : <Empty text="暂无代表项目记录" />}
        </ProfileSection>

        <ProfileSection title="已关联投资记录">
          <p className="mb-4 text-xs leading-6 text-muted-foreground">仅展示投资事件库中，投资机构字段与本档案 ID、名称或别名精确匹配的记录。</p>
          {investor.investmentHistory.length ? <div className="divide-y divide-border">{investor.investmentHistory.map((event) => <article key={event.id} className="flex flex-wrap items-start justify-between gap-3 py-3"><div><h3 className="text-sm font-medium">{event.companyName}</h3><p className="mt-1 text-xs text-muted-foreground">{event.track} · {event.round} · {event.announcedAt.slice(0, 10)}</p></div><p className="text-sm tabular-nums">{event.amount === null ? "金额未披露" : `${event.amount.toLocaleString("zh-CN")} ${event.currency || "（币种未录入）"}`}</p></article>)}</div> : <Empty text="暂无已关联的投资记录" />}
        </ProfileSection>

        <ProfileSection title="赛道历史数据">
          {Object.keys(investor.trackPerformance).length ? <><p className="mb-4 text-xs text-muted-foreground">仅展示已录入数据；跟投率不是投资回报率，样本口径请结合来源复核。</p><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-muted/55 text-xs text-muted-foreground"><tr>{["赛道", "已投数量", "退出数量", "跟投率"].map((label) => <th key={label} className="whitespace-nowrap p-3 font-medium">{label}</th>)}</tr></thead><tbody>{Object.entries(investor.trackPerformance).map(([track, value]) => <tr key={track} className="border-b border-border"><td className="p-3">{track}</td><td className="p-3">{value.invested}</td><td className="p-3">{value.exits}</td><td className="p-3">{value.followOnRate === null ? "未录入" : `${(value.followOnRate * 100).toFixed(1)}%`}</td></tr>)}</tbody></table></div></> : <Empty text="暂无经录入的赛道历史数据，不推算回报率。" />}
        </ProfileSection>
      </div>

      <aside className="grid min-w-0 gap-5">
        <ProfileSection title="来源与核验" icon={<FileCheck2 className="size-4 text-primary" aria-hidden="true" />}>
          <dl className="grid gap-4"><ProfileField label="源表标记" value={investor.extra["原始列:核验状态"]} /><ProfileField label="核验日期" value={investor.verification?.verifiedAt?.slice(0, 10)} /><ProfileField label="核验人员" value={investor.verification?.verifiedBy} /></dl>
          <p className="mt-4 whitespace-pre-wrap rounded-md bg-muted/55 p-3 text-xs leading-6">{investor.verification?.notes || "暂无核验说明。档案状态不代表系统已完成新的事实核验。"}</p>
          <h3 className="mb-3 mt-5 text-sm font-medium">来源链接</h3>
          {investor.sourceRefs.length ? <ul className="grid gap-3">{investor.sourceRefs.map((source, index) => <li key={`${source}:${index}`} className="min-w-0 text-xs leading-6">{publicSourceUrl(source) ? <a href={publicSourceUrl(source)!} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline-offset-4 hover:underline">{source}<ExternalLink className="ml-1 inline size-3" aria-label="新窗口打开" /></a> : <span className="break-all text-muted-foreground">{source}（文本来源）</span>}</li>)}</ul> : <Empty text="暂无来源链接" />}
          {investor.extra.sourceFile && <p className="mt-5 break-all border-t border-border pt-4 text-xs leading-6 text-muted-foreground">导入文件：{investor.extra.sourceFile}{investor.extra.sourceSheet ? ` / ${investor.extra.sourceSheet}` : ""}</p>}
        </ProfileSection>
        <ProfileSection title="跟进备注"><p className="whitespace-pre-wrap text-sm leading-7">{investor.notes || "暂无跟进备注"}</p><p className="mt-4 border-t border-border pt-4 text-xs leading-6 text-muted-foreground">当前为机构档案追踪；自动追踪任务以后台任务状态为准。</p></ProfileSection>
        {Object.keys(investor.extra).length > 0 && <details className="rounded-lg border border-border bg-card p-4"><summary className="cursor-pointer py-1 text-sm font-medium">查看完整导入原文</summary><dl className="mt-4 grid gap-4">{Object.entries(investor.extra).map(([key, value]) => <ProfileField key={key} label={key.replace("原始列:", "")} value={value} />)}</dl></details>}
      </aside>
    </div>
  </HubPage>;
}

function ProfileSection({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return <section className="min-w-0 rounded-lg border border-border bg-card p-5" aria-label={title}><h2 className="mb-5 flex items-center gap-2 font-semibold">{icon}{title}</h2>{children}</section>;
}
function ProfileField({ label, value }: { label: string; value?: string | null }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6">{value || "未录入"}</dd></div>;
}
function Empty({ text }: { text: string }) { return <p className="rounded-lg bg-muted/45 p-4 text-sm leading-6 text-muted-foreground">{text}</p>; }
