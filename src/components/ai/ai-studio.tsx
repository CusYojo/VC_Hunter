"use client";
import { useState } from "react";
import type { AITemplate } from "@/ai/workspace-contracts";
const control = "min-h-11 rounded-lg border px-3 text-sm disabled:opacity-50 hover:bg-muted";
export function AIStudio({ templates, refresh, onUse }: { templates: AITemplate[]; refresh: () => Promise<void>; onUse: (id: string) => void }) {
  const [editing, setEditing] = useState<AITemplate | null>(null);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  function clear() { setEditing(null); setName(""); setInstructions(""); }
  async function save(remove?: AITemplate) {
    if (busy) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const body = remove ? { id: remove.id, expectedVersion: remove.version } : { name, instructions, ...(editing ? { id: editing.id, expectedVersion: editing.version } : {}) };
      const response = await fetch("/api/v1/ai/templates", { method: remove ? "DELETE" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error?.message || "保存失败。");
      if (!remove || remove.id === editing?.id) clear();
      await refresh(); setSuccess(remove ? "已删除个人 Agent。" : "个人 Agent 已保存，可以在工作台运行。");
    } catch (error) { setError(error instanceof Error ? error.message : "保存失败。"); }
    finally { setBusy(false); }
  }
  return <section className="grid gap-5 lg:grid-cols-2">
    <form className="space-y-4 rounded-xl border bg-card p-5" onSubmit={(event) => { event.preventDefault(); void save(); }}><h2 className="font-semibold">{editing ? "编辑个人 Agent" : "新建个人 Agent"}</h2><p className="text-sm text-muted-foreground">保存常用任务指令，运行时使用你的默认 API 和模型。</p><label className="block text-sm font-medium">名称<input required value={name} maxLength={100} disabled={busy} onChange={(event) => setName(event.target.value)} className="mt-2 h-11 w-full rounded-lg border bg-background px-3" /></label><label className="block text-sm font-medium">任务指令<textarea required value={instructions} maxLength={8000} disabled={busy} onChange={(event) => setInstructions(event.target.value)} className="mt-2 min-h-40 w-full rounded-lg border bg-background p-3" placeholder="说明任务、关注点和期望输出格式。" /></label><div className="flex gap-2"><button className={`${control} bg-primary text-primary-foreground hover:bg-primary/90`} disabled={busy || !name.trim() || !instructions.trim()}>保存 Agent</button>{editing && <button type="button" className={control} disabled={busy} onClick={clear}>取消编辑</button>}</div>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{success && <p role="status" className="text-sm">{success}</p>}</form>
    <div className="space-y-3"><h2 className="font-semibold">我的 Agent · {templates.length}</h2>{templates.length === 0 && <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">还没有个人 Agent。保存后可跨设备继续使用。</p>}{templates.map((item) => <article key={item.id} className="rounded-xl border bg-card p-4"><h3 className="font-medium">{item.name}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{item.instructions}</p><div className="mt-3 flex gap-2"><button type="button" className={control} disabled={busy} onClick={() => onUse(item.id)}>使用</button><button type="button" className={control} disabled={busy} onClick={() => { setEditing(item); setName(item.name); setInstructions(item.instructions); }}>编辑</button><button type="button" className={`${control} text-destructive`} disabled={busy} onClick={() => void save(item)}>删除</button></div></article>)}</div>
  </section>;
}
