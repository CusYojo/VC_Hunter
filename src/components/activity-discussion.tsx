"use client";
import { useRef, useState, type FormEvent } from "react";
import { AtSign, MessageSquare, Reply } from "lucide-react";
import { CommentDeleteButton } from "@/components/comment-delete-button";
import { Button } from "@/components/ui/button";
import { AttachmentPicker, findFileMention, insertFileMention, type AttachedProjectFile, type FileMention } from "@/components/attachment-picker";
import { FileViewerDialog } from "@/components/file-viewer-dialog";
import type { ActivityComment, ActivityCommentPage } from "@/workbench/activity-comment-contracts";
import type { WorkspaceActivityDocument } from "@/workbench/activity-contracts";
import { recentFirstMembers, recordRecentActivityParticipants } from "@/components/activity-participant-picker";
const commentUrl = (activity: string) => `/api/v1/activity/${encodeURIComponent(activity)}/comments`;
const documentUrl = (activity: string, comment: string, document: string) => `${commentUrl(activity)}/${encodeURIComponent(comment)}/documents/${encodeURIComponent(document)}`;
function mergeComments(previous: ActivityComment[], added: ActivityComment[]) { return [...new Map([...previous, ...added].map(item => [item.id, item])).values()].sort((a, b) => a.sequence - b.sequence); }

export function ActivityDiscussion({ activityId, memberName, projectOptions, members = [], recentScopeKey }: { members?: { id: string; name: string; departmentId?: string | null; departmentName?: string | null }[]; activityId: string; memberName: (id: string) => string; projectOptions: { id: string; name: string }[]; recentScopeKey?: string }) {
  const [open, setOpen] = useState(false), [comments, setComments] = useState<ActivityComment[]>([]);
  const [pagination, setPagination] = useState({ hasMore: false, cursor: 0 });
  const [loading, setLoading] = useState(false), [sending, setSending] = useState(false), [error, setError] = useState("");
  const [body, setBody] = useState(""), [parent, setParent] = useState<ActivityComment | null>(null);
  const [files, setFiles] = useState<File[]>([]), [projectFiles, setProjectFiles] = useState<AttachedProjectFile[]>([]), [mention, setMention] = useState<FileMention | null>(null);
  const [preview, setPreview] = useState<{ comment: string; document: WorkspaceActivityDocument } | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [peopleQuery, setPeopleQuery] = useState("");
  const pending = useRef(false), requestSequence = useRef(0);
  const retry = useRef<{ serialized: string; files: File[]; key: string } | null>(null);
  const orderedMembers = recentFirstMembers(members, recentScopeKey);
  async function load(more = false) {
    if (pending.current) return;
    const sequence = ++requestSequence.current;
    setLoading(true); setError("");
    try {
      const response = await fetch(`${commentUrl(activityId)}${more ? `?after=${pagination.cursor}` : ""}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "批注读取失败，请重试。");
      if (sequence !== requestSequence.current) return;
      const page = payload.data as ActivityCommentPage;
      setComments(previous => mergeComments(more ? previous : [], page.items));
      setPagination({ hasMore: page.hasMore, cursor: page.nextCursor ?? 0 });
    } catch (failure) { if (sequence === requestSequence.current) setError(failure instanceof Error ? failure.message : "批注读取失败，请重试。"); }
    finally { if (sequence === requestSequence.current) setLoading(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || loading || (!body.trim() && !files.length && !projectFiles.length)) return;
    const serialized = JSON.stringify({ body: body.trim(), parentId: parent?.id ?? null, projectDocumentIds: projectFiles.map(file => file.id) });
    if (!retry.current || retry.current.serialized !== serialized || retry.current.files.length !== files.length || files.some((file, index) => retry.current!.files[index] !== file)) retry.current = { serialized, files: [...files], key: crypto.randomUUID() };
    pending.current = true; setSending(true); setError("");
    try {
      const form = new FormData(); form.set("payload", serialized); files.forEach(file => form.append("files", file));
      const response = await fetch(commentUrl(activityId), { method: "POST", headers: { "idempotency-key": retry.current.key, ...(!files.length ? { "content-type": "application/json" } : {}) }, body: files.length ? form : serialized });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "批注保存失败，请重试。");
      setComments(previous => mergeComments(previous, [payload.data]));
      setBody(""); setParent(null); setFiles([]); setProjectFiles([]); setMention(null); retry.current = null;
    } catch (failure) { setError(failure instanceof Error ? failure.message : "批注保存失败，请检查网络后重试。"); }
    finally { pending.current = false; setSending(false); }
  }
  function mentionPerson(name: string) {
    const start = editor.current?.selectionStart ?? body.length, end = editor.current?.selectionEnd ?? start;
    setBody(`${body.slice(0, start)}@${name} ${body.slice(end)}`);setMention(null);setPeopleOpen(false);setPeopleQuery("");
    const member = members.find(item => item.name === name);
    if (recentScopeKey && member) recordRecentActivityParticipants(recentScopeKey, [member.id]);
    window.requestAnimationFrame(() => { editor.current?.focus();editor.current?.setSelectionRange(start + name.length + 2, start + name.length + 2); });
  }
  const composer = <form onSubmit={submit} className="grid min-w-0 gap-2 border-t bg-background pt-3"><fieldset disabled={sending} className="grid min-w-0 gap-3">
        {parent && <div className="flex items-center gap-2 rounded bg-muted p-2"><p className="min-w-0 flex-1 break-words text-xs">正在回复 {memberName(parent.authorId)}：{parent.body || "附件回复"}</p><Button size="sm" variant="ghost" onClick={() => setParent(null)}>取消回复</Button></div>}
        <label className="text-sm font-medium">批注内容<textarea ref={editor} aria-label="批注内容" value={body} maxLength={10000} rows={2} placeholder="写下意见，或输入 @ 引用项目资料" className="mt-2 block min-h-20 w-full rounded-lg border bg-background p-2.5 text-[15px] font-normal" onChange={event => { setBody(event.target.value); setMention(findFileMention(event.target.value, event.target.selectionStart, [...projectFiles.map(file => file.originalName), ...members.map(member => member.name)])); }} /></label>
        <AttachmentPicker compact allowImages extraControls={<button type="button" disabled={sending} aria-expanded={peopleOpen} className="inline-flex min-h-11 items-center gap-1 rounded-lg border px-3 text-sm hover:bg-muted" onClick={() => { setPeopleOpen(!peopleOpen);setPeopleQuery("");setMention(null); }}><AtSign size={16} />@人员</button>} files={files} projectFiles={projectFiles} projects={projectOptions} busy={sending} onFilesChange={setFiles} onProjectFilesChange={setProjectFiles} mention={mention} onMentionChange={setMention} onMentionChosen={file => setBody(previous => insertFileMention(previous, mention, file))} />
        {peopleOpen && <div className="grid gap-2 rounded-lg border p-2" role="group" aria-label="可提醒的人员"><input type="search" aria-label="搜索提醒人员" placeholder="搜索姓名或部门" value={peopleQuery} onChange={event => setPeopleQuery(event.target.value)} className="min-h-10 w-full rounded-md border bg-background px-3 text-sm" /><div className="flex flex-wrap gap-2">{orderedMembers.length ? orderedMembers.filter(member => `${member.name} ${member.departmentName ?? ""}`.toLocaleLowerCase("zh-CN").includes(peopleQuery.trim().toLocaleLowerCase("zh-CN"))).map(member => <button key={member.id} type="button" className="min-h-9 rounded px-2 text-sm hover:bg-muted" onClick={() => mentionPerson(member.name)}>{member.name}</button>) : <p className="text-xs text-muted-foreground">当前事项没有其他可提醒的人员。</p>}</div></div>}
        <Button className="justify-self-end" type="submit" disabled={sending || loading || (!body.trim() && !files.length && !projectFiles.length)}>{sending ? "发表中…" : parent ? "发表回复" : "发表批注"}</Button>
      </fieldset></form>;
  return <section className="min-w-0 border-t pt-3" aria-label="事项讨论">
    <Button variant="outline" className="min-h-11" aria-expanded={open} onClick={() => { setOpen(!open); if (!open) void load(); }}><MessageSquare aria-hidden="true" />审核 / 批注</Button>
    {open && <div className="mt-3 grid min-w-0 gap-3">
      <div className="flex items-center justify-between gap-2"><p className="text-xs leading-5 text-muted-foreground">发起人和接收人均可多次批注、回复及补充文件；正式审批结果不受讨论影响。</p><Button variant="ghost" size="sm" disabled={loading || sending} onClick={() => void load()}>刷新批注</Button></div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {loading && <p role="status" className="text-sm text-muted-foreground">正在加载批注…</p>}
      {!loading && !comments.length && !error && <p className="text-sm text-muted-foreground">暂无批注，可以发表第一条意见。</p>}
      <ol className="grid min-w-0 divide-y">{comments.map(comment => {
        const target = comments.find(item => item.id === comment.parentId);
        return <li key={comment.id} className={`flex min-w-0 gap-2.5 py-3 ${comment.parentId ? "ml-5 border-l-2 border-muted pl-3" : ""}`} id={`comment-${comment.id}`}>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary" aria-hidden="true">{memberName(comment.authorId).slice(0, 1)}</span>
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"><strong>{memberName(comment.authorId)}</strong><time className="text-xs text-muted-foreground" dateTime={comment.createdAt}>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(comment.createdAt))}</time></div>
          {comment.parentId && <p className="mt-1 break-words text-xs text-muted-foreground">回复 {target ? `${memberName(target.authorId)}：${target.deletedAt ? "评论已删除" : target.body || "附件回复"}` : "此前批注（加载更多可查看）"}</p>}
          {comment.deletedAt ? <p className="mt-1 text-sm italic text-muted-foreground">该评论已删除</p> : comment.body && <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-6">{comment.body}</p>}
          {!comment.deletedAt && comment.documents.length > 0 && <ul className="mt-2 grid gap-2">{comment.documents.map(document => <li key={document.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded border bg-background p-2"><span className="min-w-0 flex-1 basis-40 break-all text-sm">{document.originalName}{document.source === "project" && <small className="block text-muted-foreground">项目库 · {document.projectName}</small>}</span><Button size="sm" variant="outline" className="min-h-10" aria-label={`预览 ${document.originalName}`} onClick={() => setPreview({ comment: comment.id, document })}>预览</Button><a className="inline-flex min-h-10 items-center px-2 text-sm text-primary" aria-label={`下载 ${document.originalName}`} href={`${documentUrl(activityId, comment.id, document.id)}?download=1`} download>下载</a></li>)}</ul>}
          <div className="mt-1 flex flex-wrap items-center gap-2">{!comment.deletedAt && <button type="button" disabled={sending || loading} className="inline-flex min-h-8 items-center gap-1 px-1 text-xs text-muted-foreground hover:text-primary" aria-label={`回复 ${memberName(comment.authorId)}的批注`} onClick={() => { setParent(comment);setPeopleOpen(false);window.requestAnimationFrame(() => editor.current?.focus()); }}><Reply size={13} aria-hidden="true" />回复</button>}
          {comment.canDelete && !comment.deletedAt && <CommentDeleteButton<ActivityComment> url={`${commentUrl(activityId)}/${encodeURIComponent(comment.id)}`} disabled={sending || loading} onBusy={value => { pending.current = value;setSending(value); }} onDeleted={deleted => { setComments(previous => mergeComments(previous, [deleted]));if (parent?.id === deleted.id) setParent(null);if (preview?.comment === deleted.id) setPreview(null); }} />}</div>
          {parent?.id === comment.id && <div className="mt-2">{composer}</div>}
          </div>
        </li>;
      })}</ol>
      {pagination.hasMore && <Button variant="outline" disabled={loading || sending} onClick={() => void load(true)}>加载更多批注</Button>}
      {preview && <FileViewerDialog key={`${preview.comment}:${preview.document.id}`} name={preview.document.originalName} kind={preview.document.kind} url={documentUrl(activityId, preview.comment, preview.document.id)} description="批注附件 · 仅相关人员可查看" details={preview.document.source === "project" ? `项目库 · ${preview.document.projectName ?? ""}` : ""} closeLabel="关闭批注附件预览" onClose={() => setPreview(null)} />}
      {!parent && composer}
    </div>}
  </section>;
}
