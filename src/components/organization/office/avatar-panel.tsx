"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Download, RefreshCw, Upload } from "lucide-react";
import type { AvatarSubmission } from "@/organization/office-avatar-contracts";
import { Button } from "@/components/ui/button";
import { fieldClass, organizationRequest } from "../api";

const avatarEndpoint = "/api/v1/organization/office/avatar";
const reviewEndpoint = "/api/v1/admin/organization/office/avatars";
const statusLabels: Record<AvatarSubmission["status"], string> = { pending: "待审核", approved: "已通过", rejected: "已退回" };
const errorText = (error: unknown) => error instanceof Error ? error.message : "保存失败，请稍后重试。";

function AvatarPreview({ src, alt }: { src: string; alt: string }) {
  return <div className="flex h-36 w-28 shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30">
    {/* Uploaded avatars are authenticated local PNG endpoints or local object URLs. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={src} alt={alt} width={64} height={96} className="h-24 w-16 object-contain [image-rendering:pixelated]" />
  </div>;
}

function OwnAvatar({ onUpdated, revision }: { onUpdated: () => void; revision: number }) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const retryKey = useRef("");
  const [item, setItem] = useState<AvatarSubmission | null>(null);
  const [selected, setSelected] = useState<{ file: File; url: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    organizationRequest<{ item: AvatarSubmission | null }>(avatarEndpoint, { signal: controller.signal })
      .then(data => { if (active) { setItem(data.item); setLoaded(true); setError(""); } })
      .catch(failure => { if (active) setError(errorText(failure)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [reload, revision]);
  useEffect(() => () => { if (selected) URL.revokeObjectURL(selected.url); }, [selected]);

  function choose(file?: File) {
    setError(""); setNotice(""); setSelected(null); retryKey.current = "";
    if (!file) return;
    if (!/\.png$/i.test(file.name) || (file.type && file.type !== "image/png")) { setError("请上传透明背景的静态 PNG 图片。"); return; }
    if (!file.size || file.size > 256 * 1024) { setError(file.size ? "头像不能超过 256 KB。" : "头像文件不能为空。"); return; }
    setSelected({ file, url: URL.createObjectURL(file) });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const form = new FormData(); form.set("file", selected.file);
      if (!retryKey.current) retryKey.current = crypto.randomUUID();
      const result = await organizationRequest<AvatarSubmission>(avatarEndpoint, { method: "POST", headers: { "Idempotency-Key": retryKey.current }, body: form });
      setItem(result); setSelected(null); retryKey.current = "";
      if (inputRef.current) inputRef.current.value = "";
      setNotice("已提交，审核通过后会显示在办公室。"); onUpdated();
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }
  return <section aria-label="我的头像" className="grid min-w-0 gap-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">我的头像</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">使用透明背景的 32 × 48 像素静态 PNG，文件不超过 256 KB。</p></div><a href="/api/v1/organization/office/avatar-template" download="office-avatar-template.png" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm text-primary hover:bg-muted focus-visible:outline-2"><Download className="size-4" aria-hidden="true" />下载头像模板</a></div>
    <p className="text-sm leading-6 text-muted-foreground">上传后由管理员审核。待审期间，办公室继续显示原有形象。</p>
    {loading && <p role="status" className="text-sm text-muted-foreground">正在加载头像…</p>}
    {loaded && <div className="flex min-w-0 items-start gap-4 rounded-lg border border-border bg-card p-4">
      {item && <AvatarPreview src={item.avatarUrl} alt="我提交的头像" />}
      <div className="min-w-0"><p className="text-sm font-medium">{item ? statusLabels[item.status] : "尚未上传自定义头像"}</p>{item?.reviewNote && <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{item.reviewNote}</p>}{item?.status === "approved" && <p className="mt-2 text-sm text-muted-foreground">你的头像已在办公室显示。</p>}</div>
    </div>}
    <form onSubmit={submit} aria-busy={busy} className="grid gap-3">
      <label htmlFor={inputId} className="text-sm font-medium">选择头像 PNG</label>
      <input ref={inputRef} id={inputId} type="file" accept=".png,image/png" disabled={busy || loading || !loaded} onChange={event => choose(event.target.files?.[0])} className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-card p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1" />
      {selected && <div className="flex min-w-0 items-center gap-4"><AvatarPreview src={selected.url} alt="待提交头像预览" /><p className="min-w-0 break-all text-sm text-muted-foreground">{selected.file.name}<br />{Math.max(1, Math.ceil(selected.file.size / 1024))} KB</p></div>}
      <Button type="submit" className="min-h-11 justify-self-start" disabled={!selected || busy || !loaded}><Upload aria-hidden="true" />{busy ? "正在提交…" : "提交头像审核"}</Button>
    </form>
    {error && <div role="alert" className="grid gap-2 text-sm text-destructive"><p>{error}</p>{!loaded && <Button type="button" variant="outline" className="min-h-11 justify-self-start" disabled={loading} onClick={() => { setError(""); setLoading(true); setReload(value => value + 1); }}>重新加载头像</Button>}</div>}
    {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
  </section>;
}

function ReviewCard({ item, onSaved, onReload }: { item: AvatarSubmission; onSaved: (item: AvatarSubmission) => void; onReload: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef<{ payload: string; key: string } | null>(null);
  async function decide(decision: "approve" | "reject") {
    if (busy) return;
    const trimmed = note.trim();
    if (decision === "reject" && !trimmed) { setError("请填写退回原因，帮助成员修改头像。"); return; }
    setBusy(true); setError("");
    try {
      const payload = JSON.stringify({ expectedVersion: item.version, decision, note: trimmed });
      if (requestRef.current?.payload !== payload) requestRef.current = { payload, key: crypto.randomUUID() };
      const result = await organizationRequest<AvatarSubmission>(`${reviewEndpoint}/${encodeURIComponent(item.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": requestRef.current.key }, body: payload });
      onSaved(result);
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }
  return <article aria-label={`${item.memberName}的头像申请`} className="grid min-w-0 gap-3 rounded-lg border border-border bg-card p-4" aria-busy={busy}>
    <div className="flex items-start gap-4"><AvatarPreview src={item.avatarUrl} alt={`${item.memberName}提交的头像`} /><div className="min-w-0"><h4 className="break-words text-sm font-semibold">{item.memberName}</h4><p className="mt-1 text-sm text-muted-foreground">{statusLabels[item.status]}</p>{item.reviewNote && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{item.reviewNote}</p>}</div></div>
    {item.status === "pending" && <><label className="grid gap-2 text-sm font-medium">审核意见 · {item.memberName}<textarea rows={2} maxLength={1000} value={note} disabled={busy} className={fieldClass} onChange={event => setNote(event.target.value)} placeholder="通过可不填，退回请说明修改要求" /></label><div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11" disabled={busy} aria-label={`批准${item.memberName}的头像`} onClick={() => decide("approve")}>批准</Button><Button type="button" variant="outline" className="min-h-11" disabled={busy} aria-label={`退回${item.memberName}的头像`} onClick={() => decide("reject")}>退回</Button></div></>}
    {error && <div role="alert" className="grid gap-2 text-sm text-destructive"><p>{error}</p><Button type="button" variant="outline" className="min-h-11 justify-self-start" disabled={busy} onClick={onReload}>重新载入申请</Button></div>}
  </article>;
}

function AvatarReviewQueue({ onUpdated }: { onUpdated: () => void }) {
  const [items, setItems] = useState<AvatarSubmission[]>([]);
  const [pendingOnly, setPendingOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    organizationRequest<{ items: AvatarSubmission[] }>(reviewEndpoint, { signal: controller.signal })
      .then(data => { if (active) { setItems(data.items); setError(""); } })
      .catch(failure => { if (active) setError(errorText(failure)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [reload]);
  function refresh() { setLoading(true); setError(""); setReload(value => value + 1); }
  function saved(item: AvatarSubmission) { setItems(current => current.map(entry => entry.id === item.id ? item : entry)); setNotice(`${item.memberName}的头像${item.status === "approved" ? "已通过审核" : "已退回"}。`); onUpdated(); }
  const visible = items.filter(item => !pendingOnly || item.status === "pending");
  return <section aria-label="头像审核" className="grid min-w-0 gap-4 border-t border-border pt-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">头像审核</h3><Button type="button" variant="outline" className="min-h-11" disabled={loading} onClick={refresh}><RefreshCw aria-hidden="true" />刷新审核列表</Button></div>
    <div className="flex flex-wrap gap-2"><Button type="button" variant={pendingOnly ? "default" : "outline"} className="min-h-11" aria-pressed={pendingOnly} onClick={() => setPendingOnly(true)}>待审核</Button><Button type="button" variant={!pendingOnly ? "default" : "outline"} className="min-h-11" aria-pressed={!pendingOnly} onClick={() => setPendingOnly(false)}>全部申请</Button></div>
    {loading && <p role="status" className="text-sm text-muted-foreground">正在加载审核列表…</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
    {!loading && !error && !visible.length && <p className="text-sm text-muted-foreground">{pendingOnly ? "没有待审核的头像" : "暂无头像申请"}</p>}
    {visible.map(item => <ReviewCard key={item.id} item={item} onSaved={saved} onReload={refresh} />)}
  </section>;
}

export function AvatarPanel({ canManage, onUpdated }: { canManage: boolean; onUpdated: () => void }) {
  const [revision, setRevision] = useState(0);
  return <div className="grid min-w-0 gap-6"><OwnAvatar revision={revision} onUpdated={onUpdated} />{canManage && <AvatarReviewQueue onUpdated={() => { setRevision(value => value + 1); onUpdated(); }} />}</div>;
}
