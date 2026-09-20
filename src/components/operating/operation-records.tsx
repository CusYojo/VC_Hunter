"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FileViewerDialog } from "@/components/file-viewer-dialog";
import { MetricCards } from "./hub-layout";
import { OperationEditor } from "./operation-editor";
import { operationConfigs, type OperationKind, type OperationRecord, type OperationWorkspace } from "@/workbench/business-operation-contracts";
const currency = (value: number) => new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 }).format(value);
export function OperationRecords({ kind }: { kind: OperationKind }) {
  const router = useRouter();
  const config = operationConfigs[kind];
  const [workspace, setWorkspace] = useState<OperationWorkspace | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [revision, setRevision] = useState(0), [includeArchived, setIncludeArchived] = useState(false), [query, setQuery] = useState("");
  const [editing, setEditing] = useState<OperationRecord | "new" | null>(null);
  const pending = useRef(false), retry = useRef<{ signature: string; files: File[]; key: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try { const response = await fetch(`/api/v1/operations/${kind}?archived=${includeArchived ? 1 : 0}`, { signal: controller.signal }); const result = await response.json(); if (!response.ok) throw new Error(result.error?.message ?? "加载记录失败，请重试。"); if (!controller.signal.aborted) setWorkspace(result.data); }
      catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "加载失败。"); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load(); return () => controller.abort();
  }, [kind, includeArchived, revision]);
  async function save(value: unknown, existing?: OperationRecord, files: File[] = []) {
    if (pending.current) return;
    const body = JSON.stringify(existing ? { ...value as object, version: existing.version } : value);
    const url = `/api/v1/operations/${kind}${existing ? `/${existing.id}` : ""}`;
    const signature = JSON.stringify([url, body]);
    if (retry.current?.signature !== signature || retry.current.files.length !== files.length || files.some((file, index) => retry.current?.files[index] !== file)) retry.current = { signature, files: [...files], key: crypto.randomUUID() };
    pending.current = true; setBusy(true); setError("");
    try {
      const multipart = files.length ? new FormData() : null;
      if (multipart) { multipart.set("payload", body); files.forEach(file => multipart.append("files", file)); }
      const response = await fetch(url, { method: existing ? "PATCH" : "POST", headers: { ...(!multipart ? { "content-type": "application/json" } : {}), "idempotency-key": retry.current.key }, body: multipart ?? body });
      const result = await response.json(); if (!response.ok) throw new Error(result.error?.message ?? "保存失败，请重试。");
      const item = result.data as OperationRecord;
      setWorkspace((previous) => previous ? { ...previous, records: [item, ...previous.records.filter((row) => row.id !== item.id)].filter((row) => includeArchived || !row.archived) } : previous);
      setEditing(null); retry.current = null; router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "保存失败。"); }
    finally { pending.current = false; setBusy(false); }
  }
  const active = workspace?.records.filter((item) => !item.archived) ?? [];
  const records = workspace?.records.filter((item) => `${item.name} ${JSON.stringify(item.data)}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  return <section className="space-y-4" aria-label={`${config.label}记录`}>
    {kind === "payment" && <p className="rounded-lg border bg-muted/30 p-3 text-sm">付款记录用于登记计划与已执行付款；保存记录不会发起银行转账。已付款需提供实际日期和凭证编号。</p>}
    <MetricCards items={[{ label: `${config.label}记录`, value: loading ? "—" : active.length, detail: "当前工作空间未归档记录" }, ...(config.fields.some((field) => field.key === "amountCny") ? [{ label: kind === "fund" ? "认缴金额合计" : "登记金额合计", value: loading ? "—" : currency(active.reduce((sum, item) => sum + Number(item.data.amountCny ?? 0), 0)), detail: "人民币，按当前类型汇总" }] : [])]} />
    <div className="flex flex-wrap items-center gap-3"><input aria-label={`搜索${config.label}`} placeholder={`搜索${config.label}`} value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-10 flex-1 rounded-lg border bg-background px-3" /><label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={includeArchived} disabled={busy || loading || editing !== null} onChange={(event) => { setLoading(true); setError(""); setIncludeArchived(event.target.checked); }} />包含已归档</label><Button variant="outline" disabled={busy || loading || editing !== null} onClick={() => { setLoading(true); setError(""); setRevision((value) => value + 1); }}>刷新</Button>{workspace?.canWrite && <Button disabled={busy || loading} onClick={() => { setError(""); setEditing("new"); }}>新建{config.label}</Button>}</div>
    {loading && <p role="status">正在加载真实记录…</p>}
    {error && !editing && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!loading && workspace && records.length === 0 && <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">{query ? "没有匹配的记录" : `暂无${config.label}记录`}</div>}
    <div className="grid gap-3">{records.map((record) => <article key={record.id} className="rounded-xl border bg-card p-4"><div className="flex flex-wrap items-center gap-3"><h3 className="flex-1 font-semibold">{record.name}</h3><span className="rounded border px-2 py-1 text-xs">{record.archived ? "已归档" : config.statuses[record.status]}</span>{typeof record.data.amountCny === "number" && <strong>{currency(record.data.amountCny)}</strong>}</div><details className="mt-3"><summary className="min-h-10 cursor-pointer py-2 text-sm text-primary">查看详情与关联资料</summary><OperationDetails record={record} workspace={workspace!} /></details>{workspace?.canWrite && <div className="mt-2 flex flex-wrap gap-2"><Button variant="outline" disabled={busy || loading} onClick={() => { setError(""); setEditing(record); }}>编辑 {record.name}</Button><Button variant="outline" disabled={busy || loading} onClick={() => void save({ archived: !record.archived }, record)}>{record.archived ? "恢复" : "归档"} {record.name}</Button></div>}</article>)}</div>
    <Sheet open={editing !== null} onOpenChange={(open) => { if (!open && !busy) { setEditing(null); setError(""); retry.current = null; } }}><SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl"><SheetHeader><SheetTitle>{editing === "new" ? "新建" : "编辑"}{config.label}</SheetTitle><SheetDescription>保存到团队工作空间，保留修改历史与资料关联。</SheetDescription></SheetHeader>{error && editing && <p role="alert" className="px-4 text-sm text-destructive">{error}</p>}{editing && workspace && <OperationEditor key={typeof editing === "object" ? `${editing.id}-${editing.version}` : "new"} kind={kind} record={editing === "new" ? null : editing} workspace={workspace} busy={busy} onSave={(value, files) => void save(value, editing === "new" ? undefined : editing, files)} />}</SheetContent></Sheet>
  </section>;
}
function OperationDetails({ record, workspace }: { record: OperationRecord; workspace: OperationWorkspace }) {
  const documents = record.documents?.map(document => ({ ...document, url: `/api/v1/operations/${record.kind}/${encodeURIComponent(record.id)}/documents/${encodeURIComponent(document.id)}` })) ?? ((record.data.documentIds ?? []) as string[]).map(id => {
    const document = workspace.documents.find(item => item.id === id);
    return { id, originalName: document?.originalName ?? "关联资料", kind: document?.originalName.toLowerCase().endsWith(".pdf") ? "pdf" : document?.originalName.toLowerCase().endsWith(".docx") ? "docx" : "text", source: "project", url: `/api/v1/projects/${encodeURIComponent(document?.projectId ?? String(record.data.projectId))}/documents/${encodeURIComponent(id)}/content` };
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = documents.find(document => document.id === selectedId);
  return <><dl className="grid gap-2 text-sm sm:grid-cols-2">{operationConfigs[record.kind].fields.map((field) => {
    const value = record.data[field.key]; if (value === undefined || value === "" || (Array.isArray(value) && !value.length)) return null;
    if (field.type === "documents") return null;
    const label = field.type === "project" ? workspace.projects.find((item) => item.id === value)?.name ?? "原项目" : field.type === "fund" ? workspace.funds.find((item) => item.id === value)?.name ?? "原基金（可能已归档）" : field.type === "money" ? currency(Number(value)) : String(value);
    return <div key={field.key} className={field.type === "textarea" ? "sm:col-span-2" : ""}><dt className="text-muted-foreground">{field.label}</dt><dd className="whitespace-pre-wrap break-words">{field.type === "project" ? <a href={`/projects/${encodeURIComponent(String(value))}`} className="text-primary underline">{label}</a> : label}</dd></div>;
  })}{documents.length > 0 && <div className="sm:col-span-2"><dt className="text-muted-foreground">附件与项目资料</dt><dd className="mt-2 grid gap-2">{documents.map(document => <div key={document.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2"><span className="min-w-0 flex-1 break-words text-sm">{document.originalName}<span className="ml-2 text-xs text-muted-foreground">{document.source === "upload" ? "上传附件" : "项目库引用"}</span></span><button type="button" aria-label={`查看 ${document.originalName}`} onClick={() => setSelectedId(document.id)} className="min-h-11 rounded-lg px-3 text-sm text-primary hover:bg-muted">查看</button><a className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-primary hover:bg-muted" href={`${document.url}?download=1`} aria-label={`${document.originalName} · 下载`}>下载</a></div>)}</dd></div>}<div className="sm:col-span-2 text-xs text-muted-foreground">更新：{new Date(record.updatedAt).toLocaleString("zh-CN")} · 版本 {record.version}</div></dl>
    {selected && <FileViewerDialog key={selected.id} name={selected.originalName} kind={selected.kind} url={selected.url} description={`${record.name} · ${selected.source === "upload" ? "上传附件" : "项目库引用"}`} closeLabel="Close" onClose={() => setSelectedId(null)} />}
  </>;
}
