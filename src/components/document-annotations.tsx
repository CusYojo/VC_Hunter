"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CommentDeleteButton } from "@/components/comment-delete-button";
import type { DocumentAnnotation, DocumentAnnotationAction, DocumentAnnotationsResponse, DocumentReviewStatus } from "@/workbench/project-document-contracts";

const actionLabel = { comment: "批注", approve: "已通过", request_changes: "要求修改" };
const buttonClass = "min-h-10 rounded-lg border px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 hover:bg-muted";
type Props = { url: string; onStatus: (status: DocumentReviewStatus) => void; onBusy: (busy: boolean) => void };

export function DocumentAnnotations({ url, onStatus, onBusy }: Props) {
  const [discussion, setDiscussion] = useState<DocumentAnnotationsResponse | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const pending = useRef(false);
  const retry = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(url, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message || "加载批注失败，请重试。");
        if (!controller.signal.aborted) { setDiscussion(result.data); onStatus(result.data.reviewStatus); }
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "加载批注失败，请重试。"); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [url, revision, onStatus]);

  async function submit(action: DocumentAnnotationAction, parentId: string | null = null) {
    const content = (parentId ? reply : draft).trim();
    if (pending.current || loading || (action !== "approve" && !content)) return;
    const body = JSON.stringify({ action, content, parentId });
    if (retry.current?.body !== body) retry.current = { body, key: crypto.randomUUID() };
    pending.current = true; setBusy(true); onBusy(true); setError("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": retry.current.key }, body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "保存失败，请重试。");
      setDiscussion(result.data); onStatus(result.data.reviewStatus); retry.current = null;
      if (parentId) { setReply(""); setReplyTo(null); } else setDraft("");
    } catch (error) { setError(error instanceof Error ? error.message : "保存失败，请重试。"); }
    finally { pending.current = false; setBusy(false); onBusy(false); }
  }

  function deletionBusy(value: boolean) {
    pending.current = value; setBusy(value); onBusy(value);
    if (value) setError("");
  }
  function annotation(note: DocumentAnnotation) {
    return <AnnotationText note={note}>{note.action === "comment" && note.canDelete && !note.deletedAt && <CommentDeleteButton<DocumentAnnotationsResponse>
      url={`${url}/${encodeURIComponent(note.id)}`} disabled={busy || loading} onBusy={deletionBusy}
      onDeleted={(data) => {
        setDiscussion(data); onStatus(data.reviewStatus);
        if (replyTo === note.id) { setReplyTo(null); setReply(""); retry.current = null; }
      }}
    />}</AnnotationText>;
  }

  const canComment = discussion?.permissions.canComment;
  const canReview = discussion?.permissions.canReview;
  return <section className="flex min-h-0 flex-1 flex-col" aria-label="资料审核与批注" aria-busy={busy || loading}>
    <header className="border-b px-4 py-3">
      <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">审核与批注</h3><button type="button" className={buttonClass} disabled={busy || loading} onClick={() => { setLoading(true); setError(""); setRevision((value) => value + 1); }}>刷新批注</button></div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">这里记录本份资料的审核意见，正式审批请前往审批中心。</p>
      {discussion && <p className="mt-2 text-sm font-medium">{({ pending: "资料待审核", approved: "资料已通过", changes_requested: "资料需修改" })[discussion.reviewStatus]}</p>}
    </header>
    <div className="min-h-32 flex-1 overflow-y-auto p-4">
      {loading && <p role="status" className="text-sm text-muted-foreground">正在加载批注…</p>}
      {discussion?.items.length === 0 && <p className="py-6 text-sm text-muted-foreground">还没有批注，可以发表第一条意见。</p>}
      <div className="divide-y divide-border/60">{discussion?.items.filter((item) => item.parentId === null).map((note) => <article key={note.id} aria-label={note.deletedAt ? "已删除的批注" : `批注：${note.content || actionLabel[note.action]}`} className="py-3 first:pt-0 last:pb-0">
        {annotation(note)}
        {discussion.items.some((item) => item.parentId === note.id) && <div className="ml-4 mt-3 space-y-3 border-l border-border/60 pl-4">{discussion.items.filter((item) => item.parentId === note.id).map((item) => <div key={item.id}>{annotation(item)}</div>)}</div>}
        {canComment && !note.deletedAt && <button type="button" disabled={busy || loading} className="ml-10 mt-1 min-h-9 text-sm font-medium text-primary disabled:opacity-50" aria-label={`回复批注：${note.content || actionLabel[note.action]}`} onClick={() => { setReplyTo(note.id); setReply(""); }}>回复</button>}
        {replyTo === note.id && !note.deletedAt && <div className="ml-10 mt-2 space-y-2"><label className="block text-sm">回复内容<textarea value={reply} maxLength={10000} disabled={busy} onChange={(event) => setReply(event.target.value)} className="mt-2 min-h-20 w-full rounded-lg border bg-background p-2 text-[15px]" /></label><div className="flex gap-2"><button type="button" className={buttonClass} disabled={busy || loading || !reply.trim()} onClick={() => void submit("comment", note.id)}>发送回复</button><button type="button" className={buttonClass} disabled={busy} onClick={() => { setReplyTo(null); setReply(""); }}>取消回复</button></div></div>}
      </article>)}</div>
    </div>
    {error && <p role="alert" className="px-4 py-2 text-sm text-destructive">{error}</p>}
    {(canComment || canReview) && <div className="space-y-3 border-t bg-card p-4"><label className="block text-sm font-medium">批注 / 审核意见<textarea value={draft} maxLength={10000} disabled={busy} onChange={(event) => setDraft(event.target.value)} placeholder="写下意见、待核对问题或修改要求…" className="mt-2 min-h-24 w-full rounded-lg border bg-background p-3 text-[15px] font-normal" /></label><div className="flex flex-wrap gap-2">
      {canComment && <button type="button" className={`${buttonClass} border-primary bg-primary text-primary-foreground hover:bg-primary/90`} disabled={busy || loading || !draft.trim()} onClick={() => void submit("comment")}>发表批注</button>}
      {canReview && <><button type="button" className={buttonClass} disabled={busy || loading} onClick={() => void submit("approve")}>标记通过</button><button type="button" className={buttonClass} disabled={busy || loading || !draft.trim()} onClick={() => void submit("request_changes")}>要求修改</button></>}
    </div>{busy && <p role="status" className="text-xs text-muted-foreground">正在保存…</p>}</div>}
    {discussion && !canComment && !canReview && <p className="border-t p-4 text-xs text-muted-foreground">你可以查看这份资料和讨论，当前账号没有发表或审核权限。</p>}
  </section>;
}

function AnnotationText({ note, children }: { note: DocumentAnnotation; children?: ReactNode }) {
  return <div className="flex min-w-0 items-start gap-2.5">
    <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{note.authorName.trim().slice(0, 1) || "人"}</span>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"><strong className="text-sm font-semibold">{note.authorName}</strong>{note.action !== "comment" && <span className="rounded bg-muted px-1.5 py-0.5">{actionLabel[note.action]}</span>}<time dateTime={note.createdAt} className="text-muted-foreground">{new Date(note.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time>{children}</div>
      {note.deletedAt ? <p className="mt-1 text-sm italic text-muted-foreground">该批注已删除</p> : note.content && <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-6">{note.content}</p>}
    </div>
  </div>;
}
