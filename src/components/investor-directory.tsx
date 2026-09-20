"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Select, SelectItem, TextInput } from "@/components/ui/legacy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, Building2 } from "lucide-react";
import { INSTITUTION_LABELS, INVESTOR_STATUS_LABELS, INVESTOR_PRIORITY_LABELS } from "./investor-fields";
import { TRACKS } from "@/domain/projects";

/** 头部机构名录：客户端筛选 + 分页，从 `/api/v1/investors` 拉取。 */

interface DirectoryInvestor {
  id: string; name: string; englishName: string | null; institutionType: string; headquarters: string | null;
  focusTracks: string[]; subtracks: string[]; investmentStyle: string | null; status: string; priority: number; rank: number | null;
  portfolioCount: number; fundSize: { text: string } | null;
}

export function InvestorDirectory({ initial, total: initialTotal }: { initial: DirectoryInvestor[]; total: number }) {
  const [items, setItems] = useState(initial);
  const [total, setTotal] = useState(initialTotal);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [track, setTrack] = useState("all");
  const [priority, setPriority] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const perPage = 60;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const handle = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
        if (query.trim()) params.set("query", query.trim());
        if (type !== "all") params.set("type", type);
        if (track !== "all") params.set("track", track);
        if (priority !== "all") params.set("priority", priority);
        if (status !== "all") params.set("status", status);
        const response = await fetch(`/api/v1/investors?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message ?? "机构列表加载失败，请重试。");
        if (!Array.isArray(payload.data?.items) || typeof payload.data.total !== "number") throw new Error("机构列表返回格式异常。");
        if (active) { setItems(payload.data.items as DirectoryInvestor[]); setTotal(payload.data.total as number); }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "机构列表加载失败，请重试。");
      } finally { if (active) setLoading(false); }
    }, 220);
    return () => { active = false; clearTimeout(handle); controller.abort(); };
  }, [query, type, track, priority, status, page, retry]);

  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / perPage)), [total]);
  const resetPage = <T,>(setter: (value: T) => void) => (value: T) => { setPage(1); setter(value); };

  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 xl:grid-cols-[minmax(14rem,2fr)_repeat(4,minmax(7rem,1fr))]">
        <TextInput id="dir-query" labelText="搜索机构" placeholder="名称 / 英文名 / 总部 / 别名" value={query} onChange={(event) => resetPage(setQuery)(event.target.value)} />
        <Select id="dir-type" labelText="机构类型" value={type} onChange={(event) => resetPage(setType)(event.target.value)}><SelectItem value="all" text="全部类型" />{Object.entries(INSTITUTION_LABELS).map(([value, label]) => <SelectItem key={value} value={value} text={label} />)}</Select>
        <Select id="dir-track" labelText="赛道" value={track} onChange={(event) => resetPage(setTrack)(event.target.value)}><SelectItem value="all" text="全部赛道" />{TRACKS.map((item) => <SelectItem key={item} value={item} text={item} />)}</Select>
        <Select id="dir-priority" labelText="优先级" value={priority} onChange={(event) => resetPage(setPriority)(event.target.value)}><SelectItem value="all" text="全部" />{Object.entries(INVESTOR_PRIORITY_LABELS).map(([value, label]) => <SelectItem key={value} value={value} text={label} />)}</Select>
        <Select id="dir-status" labelText="状态" value={status} onChange={(event) => resetPage(setStatus)(event.target.value)}><SelectItem value="all" text="全部状态" />{Object.entries(INVESTOR_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value} text={label} />)}</Select>
      </div>

      <div role="status" className="flex items-center justify-between text-sm text-muted-foreground"><span>共 <strong className="text-foreground">{total}</strong> 家机构{loading ? " · 加载中…" : ""}</span><span>按优先级排序</span></div>
      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive"><span>{error} 当前保留上一次结果。</span><Button variant="outline" className="min-h-11" onClick={() => setRetry((value) => value + 1)}>重试</Button></div>}

      {items.length === 0 ? <div className="empty-state"><strong>没有匹配的机构</strong><p>调整筛选条件，或稍后导入更多名录数据。</p></div> : (
        <div aria-busy={loading} className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {items.map((investor) => (
            <Link className="group grid min-w-0 gap-4 rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-primary/[0.02] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" key={investor.id} href={`/investors/${encodeURIComponent(investor.id)}`}>
              <header className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/[0.07] text-primary"><Building2 className="size-5" aria-hidden="true" /></span>
                <div className="min-w-0 flex-1"><h3 className="font-semibold text-foreground">{investor.name}</h3><p className="mt-1 text-xs text-muted-foreground">{INSTITUTION_LABELS[investor.institutionType] ?? investor.institutionType} · {investor.headquarters || "地区未录入"}</p></div>
                <ArrowUpRight className="size-4 text-muted-foreground group-hover:text-primary" aria-hidden="true" />
              </header>
              {investor.englishName && <p className="text-sm text-muted-foreground">{investor.englishName}</p>}
              <div className="flex flex-wrap gap-1.5">{investor.focusTracks.length ? investor.focusTracks.map((track) => <Badge key={track} variant="secondary">{track}</Badge>) : <span className="text-sm text-muted-foreground">赛道未分类</span>}</div>
              <div className="rounded-md bg-muted/55 p-3 text-sm"><p className="text-xs text-muted-foreground">公开管理规模 / 体系规模</p><p className="mt-1 leading-6">{investor.fundSize?.text || "未录入"}</p></div>
              {investor.investmentStyle && <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">{investor.investmentStyle}</p>}
              <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                <span className="text-xs text-muted-foreground">已关联投资记录 <strong className="text-foreground">{investor.portfolioCount}</strong></span>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="border-primary/20 text-primary">{INVESTOR_PRIORITY_LABELS[investor.priority]}</Badge>
                  <Badge variant="secondary">{INVESTOR_STATUS_LABELS[investor.status] ?? investor.status}</Badge>
                </div>
              </footer>
            </Link>
          ))}
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-4 rounded-lg border border-border bg-card p-3 text-sm">
          <Button variant="outline" className="min-h-11" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</Button>
          <span>第 {page} / {pageCount} 页</span>
          <Button variant="outline" className="min-h-11" disabled={page >= pageCount || loading} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>下一页</Button>
        </div>
      )}
    </div>
  );
}
