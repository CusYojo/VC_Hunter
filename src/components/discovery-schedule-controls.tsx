"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3, Pause, Play, RefreshCw } from "lucide-react";
import type { DiscoveryScheduleView } from "@/workbench/discovery-schedule-contracts";

const endpoint = "/api/v1/discovery/schedule";
async function readSchedule(): Promise<DiscoveryScheduleView> {
  const response = await fetch(endpoint); const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || "定时发现状态读取失败。");
  return payload.data;
}
export function DiscoveryScheduleControls({ canAdmin }: { canAdmin: boolean }) {
  const [schedule, setSchedule] = useState<DiscoveryScheduleView | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState("");
  const pending = useRef(false);
  const load = useCallback(async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      setSchedule(await readSchedule());
    } catch (failure) { setError(failure instanceof Error ? failure.message : "读取失败，请刷新重试。"); }
    finally { pending.current = false; setBusy(false); }
  }, []);
  useEffect(() => {
    let live = true; pending.current = true;
    void readSchedule().then(value => { if (live) setSchedule(value); }).catch(failure => {
      if (live) setError(failure instanceof Error ? failure.message : "读取失败，请刷新重试。");
    }).finally(() => { if (live) { pending.current = false; setBusy(false); } });
    return () => { live = false; };
  }, []);
  async function toggle() {
    if (!canAdmin || !schedule || pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: !schedule.enabled, version: schedule.version }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "定时发现设置保存失败。");
      setSchedule(payload.data);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "保存失败，请刷新后重试。"); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section aria-label="AI 定时发现" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
    <div className="min-w-0"><h2 className="flex items-center gap-2 text-sm font-semibold"><Clock3 className="size-4 text-primary" aria-hidden="true" />AI 定时发现</h2><p className="mt-1 text-xs leading-6 text-muted-foreground">每天 10:00、14:00 · 北京时间（Asia/Shanghai）</p>{schedule && <><p className="text-sm">{schedule.enabled ? "定时发现已开启" : "定时发现已暂停"}</p>{schedule.enabled && <p className="text-xs leading-6 text-muted-foreground">{schedule.nextRunAt ? `下次：${new Date(schedule.nextRunAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} · ${schedule.planCount} 条搜索计划` : "暂无启用的搜索计划，请联系管理员。"}</p>}</>}<p className="text-xs leading-6 text-muted-foreground">人工上传随时可用；定时发现沿用平台当前搜索服务与模型配置。</p>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</div>
    <div className="flex flex-wrap gap-2"><button type="button" aria-label="刷新定时发现状态" disabled={busy} onClick={() => void load()} className="grid size-11 place-items-center rounded-lg border hover:bg-muted disabled:opacity-50"><RefreshCw className="size-4" aria-hidden="true" /></button>{canAdmin && <button type="button" disabled={busy || !schedule} onClick={() => void toggle()} className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm hover:bg-muted disabled:opacity-50">{schedule?.enabled ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}{schedule?.enabled ? "暂停定时发现" : "开启定时发现"}</button>}</div>
  </section>;
}
