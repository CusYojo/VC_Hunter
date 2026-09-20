"use client";
import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";

export function CommentDeleteButton<T>({ url, onDeleted, disabled = false, onBusy, label = "删除评论" }: {
  url: string; onDeleted: (data: T) => void; disabled?: boolean; onBusy?: (busy: boolean) => void; label?: string;
}) {
  const [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pending = useRef(false);
  async function remove() {
    if (pending.current || disabled) return;
    pending.current = true;setBusy(true);onBusy?.(true);setError("");
    try {
      const response = await fetch(url, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "删除失败，请重试。");
      onDeleted(payload.data as T);setConfirming(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "删除失败，请重试。"); }
    finally { pending.current = false;setBusy(false);onBusy?.(false); }
  }
  const style = "inline-flex min-h-8 items-center gap-1 rounded px-1.5 text-xs disabled:opacity-50 hover:bg-muted";
  return <span className="inline-flex flex-wrap items-center gap-1">
    {!confirming ? <button type="button" className={`${style} text-muted-foreground`} disabled={disabled} aria-label={label} onClick={() => setConfirming(true)}><Trash2 size={13} />删除</button> : <span className="inline-flex flex-wrap items-center gap-1 rounded bg-muted/60 px-1 text-xs" role="group" aria-label="确认删除评论"><span>删除这条评论？回复会保留。</span><button type="button" className={`${style} text-destructive`} disabled={busy || disabled} onClick={() => void remove()}>{busy ? "删除中…" : "确认删除"}</button><button type="button" className={style} disabled={busy} onClick={() => { setConfirming(false);setError(""); }}>取消删除</button></span>}
    {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
  </span>;
}
