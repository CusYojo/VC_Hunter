"use client";

import { useMemo, useState } from "react";
import { Tag } from "@/components/ui/legacy";

/** 市场投融资看板：只做展示，数据由服务端 `buildFundingDashboard` 预聚合后传入。 */

interface DashboardTotals { events: number; disclosedCny: number; disclosedUsd: number; undisclosed: number; maEvents: number }
interface TrackRow { track: string; events: number; amountCny: number; leadInvestors: string[] }
interface RoundRow { round: string; events: number }
interface MonthRow { month: string; events: number; amountCny: number }
interface ActiveInvestor { investorId: string; name: string; events: number; leadCount: number; status: string | null }
interface LatestEvent { id: string; companyName: string; track: string; round: string; announcedAt: string; amount: number | null; currency: "CNY" | "USD" | null; disclosureType: string; leadInvestors: string[] }
export interface FundingDashboardData {
  asOf: string; windowDays: number; totals: DashboardTotals;
  byTrack: TrackRow[]; byRound: RoundRow[]; monthly: MonthRow[]; activeInvestors: ActiveInvestor[]; latestEvents: LatestEvent[];
}

const ROUND_LABEL: Record<string, string> = { angel: "天使轮", pre_a: "Pre-A", a: "A 轮", b: "B 轮", c: "C 轮", d_plus: "D 轮及以后", strategic: "战略投资", other: "其他" };

export function FundingDashboard({ data, investorNames = {} }: { data: FundingDashboardData; investorNames?: Record<string, string> }) {
  const [windowDays, setWindowDays] = useState(data.windowDays);
  const [current, setCurrent] = useState(data);
  const [loading, setLoading] = useState(false);
  const maxMonthly = useMemo(() => Math.max(1, ...current.monthly.map((item) => item.events)), [current.monthly]);

  async function reload(nextWindow: number) {
    setWindowDays(nextWindow); setLoading(true);
    try {
      const response = await fetch(`/api/v1/funding-dashboard?window=${nextWindow}`, { cache: "no-store" });
      const payload = await response.json();
      if (response.ok) setCurrent(payload.data as FundingDashboardData);
    } finally { setLoading(false); }
  }

  const nameOf = (id: string) => investorNames[id] ?? id;

  return (
    <div className="funding-dashboard">
      <div className="dashboard-toolbar">
        <p className="section-kicker">统计窗口</p>
        <div className="window-switch" role="group" aria-label="统计窗口">
          {[30, 90, 180, 365].map((days) => (
            <button key={days} type="button" className={days === windowDays ? "is-active" : ""} disabled={loading} onClick={() => reload(days)}>{days === 365 ? "近一年" : `近 ${days} 天`}</button>
          ))}
        </div>
        <small className="cell-secondary">截至 {formatDate(current.asOf)}{loading ? " · 更新中…" : ""}</small>
      </div>

      <div className="metric-cards">
        <article className="metric-card"><span>披露事件</span><strong>{current.totals.events}</strong><small>含 {current.totals.undisclosed} 起未披露金额</small></article>
        <article className="metric-card"><span>人民币披露总额</span><strong>{formatCny(current.totals.disclosedCny)}</strong><small>仅同币种加总，不做汇率换算</small></article>
        <article className="metric-card"><span>美元披露总额</span><strong>{formatUsd(current.totals.disclosedUsd)}</strong><small>单独计量</small></article>
        <article className="metric-card"><span>并购 / 战投</span><strong>{current.totals.maEvents}</strong><small>窗口内公告</small></article>
      </div>

      <div className="dashboard-grid">
        <section className="work-panel">
          <div className="panel-heading"><div><p className="section-kicker">月度节奏</p><h3>近 12 个月出手数</h3></div></div>
          <div className="month-bars">
            {current.monthly.map((item) => (
              <div key={item.month} className="month-bar" title={`${item.month}：${item.events} 起 · ${formatCny(item.amountCny)}`}>
                <div className="bar-track"><div className="bar-fill" style={{ height: `${Math.round((item.events / maxMonthly) * 100)}%` }} /></div>
                <span>{item.month.slice(5)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="work-panel">
          <div className="panel-heading"><div><p className="section-kicker">赛道分布</p><h3>按赛道</h3></div></div>
          <div className="track-bars">
            {current.byTrack.map((item) => (
              <div key={item.track} className="track-bar-row">
                <span className="track-name">{item.track}</span>
                <div className="track-bar"><div className="track-bar-fill" style={{ width: `${Math.round((item.events / Math.max(1, current.byTrack[0]?.events ?? 1)) * 100)}%` }} /></div>
                <span className="track-count">{item.events} 起 · {formatCny(item.amountCny)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="work-panel">
          <div className="panel-heading"><div><p className="section-kicker">轮次结构</p><h3>按轮次</h3></div></div>
          <div className="round-tags">
            {current.byRound.map((item) => <div key={item.round} className="round-chip"><strong>{item.events}</strong><span>{ROUND_LABEL[item.round] ?? item.round}</span></div>)}
          </div>
        </section>

        <section className="work-panel">
          <div className="panel-heading"><div><p className="section-kicker">活跃机构</p><h3>窗口内出手最多</h3></div></div>
          {current.activeInvestors.length === 0 ? <div className="empty-state"><p>窗口内暂无机构出手记录。</p></div> : (
            <ol className="ranked-list">
              {current.activeInvestors.map((item, index) => (
                <li key={item.investorId}>
                  <span className="rank-index">{index + 1}</span>
                  <div><strong>{nameOf(item.name)}</strong><small>出手 {item.events} · 领投 {item.leadCount}</small></div>
                  {item.status && <Tag size="sm" type={item.status === "active" ? "green" : "gray"}>{statusLabel(item.status)}</Tag>}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section className="work-panel">
        <div className="panel-heading"><div><p className="section-kicker">最新动态</p><h3>最近 {current.latestEvents.length} 起融资</h3></div></div>
        <div className="deal-table">
          <div className="deal-row deal-head"><span>公司</span><span>轮次</span><span>金额</span><span>领投方</span><span>时间</span></div>
          {current.latestEvents.map((event) => (
            <div className="deal-row" key={event.id}>
              <span><strong>{event.companyName}</strong><small className="cell-secondary">{event.track}</small></span>
              <span>{ROUND_LABEL[event.round] ?? event.round}</span>
              <span>{formatAmount(event.amount, event.currency, event.disclosureType)}</span>
              <span>{event.leadInvestors.length > 0 ? nameOf(event.leadInvestors[0]) : "未披露"}</span>
              <span className="cell-secondary">{event.announcedAt}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const statusLabel = (value: string) => ({ seed_candidate: "候选", verified: "已核实", active: "活跃", paused: "暂停", merged: "已合并" }[value] ?? value);
const formatDate = (value: string) => new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeZone: "Asia/Shanghai" }).format(new Date(value));
function formatCny(amount: number): string { if (!amount) return "¥ 0"; if (amount >= 1_0000_0000) return `¥ ${(amount / 1_0000_0000).toFixed(2)} 亿`; if (amount >= 1_0000) return `¥ ${(amount / 1_0000).toFixed(1)} 万`; return `¥ ${amount.toFixed(0)}`; }
function formatUsd(amount: number): string { if (!amount) return "$ 0"; if (amount >= 1_000_000_000) return `$ ${(amount / 1_000_000_000).toFixed(2)}B`; if (amount >= 1_000_000) return `$ ${(amount / 1_000_000).toFixed(1)}M`; return `$ ${amount.toFixed(0)}`; }
function formatAmount(amount: number | null, currency: "CNY" | "USD" | null, disclosure: string): string {
  if (amount === null) return disclosure === "undisclosed" ? "未披露" : "区间披露";
  return currency === "USD" ? formatUsd(amount) : formatCny(amount);
}
