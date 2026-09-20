import { normalizeNewsPublishedAt } from "@/domain/news-publication";
import { shanghaiDate } from "@/workbench/candidate-queue-contracts";
import { ArrowUpRight } from "lucide-react";
import type { CandidateView } from "@/workbench/candidate-details";
import { publicSourceUrl } from "./investor-fields";

const signalLabel = (value: string) => ({ manual_upload: "上传资料", investment: "融资事件", equity_financing: "股权融资", listing: "上市", ipo: "IPO", acquisition: "收并购", funding_detected: "融资信号", technology_milestone: "技术进展", customer_order: "客户订单", talent_change: "人才变化" }[value] ?? value);

export function CandidateDiscoveryDetails({ candidate }: { candidate: CandidateView }) {
  const sources = candidate.origin === "manual_screenshot" ? candidate.sources ?? [] : candidate.sources?.length ? candidate.sources : [candidate.lead];
  const links = sources.filter((source) => publicSourceUrl(source.url));
  return <div className="grid gap-3 rounded-lg bg-muted/50 p-3 text-xs leading-6">
    <p><strong>发现信号：</strong>{signalLabel(candidate.eventType || candidate.signalType)}</p>
    <p className="whitespace-pre-wrap">{candidate.summary}</p>
    {candidate.verificationNotes && <div><strong>核验说明</strong><p className="mt-1 whitespace-pre-wrap">{candidate.verificationNotes}</p></div>}
    <div><strong>公开来源</strong>{links.length ? <ul className="mt-1 grid gap-2">{links.map((source, index) => <li key={`${source.url}:${index}`}><a className="break-words text-primary hover:underline" href={publicSourceUrl(source.url)!} target="_blank" rel="noopener noreferrer">{source.title}<ArrowUpRight className="ml-1 inline size-3" aria-hidden="true" /></a>{source.publishedAt && <span className="ml-2 text-muted-foreground">{normalizeNewsPublishedAt(source.publishedAt) ? shanghaiDate(normalizeNewsPublishedAt(source.publishedAt)!) : "日期待核验"}</span>}</li>)}</ul> : <p className="mt-1 text-muted-foreground">暂无可核验的公开来源链接</p>}</div>
    {candidate.eventType === "manual_upload" && <a className="font-medium text-primary underline" href={`/api/v1/candidates/${candidate.id}/document?download=1`}>下载原始资料：{candidate.sourceScreenshot}</a>}
    {candidate.origin === "manual_screenshot" && <p className="break-words text-muted-foreground">来源存档：{candidate.sourceScreenshot || "未录入"}{candidate.sourceRow ? ` · 第 ${candidate.sourceRow} 行` : ""}。资料转录不等同于事实核验。</p>}
  </div>;
}
