"use client";
import { useRef, useState } from "react";
import { ArrowUp, FileText, LibraryBig, Paperclip, ScanSearch, Search, ShieldCheck, X } from "lucide-react";
import { AI_SKILLS, type AITemplate } from "@/ai/workspace-contracts";
import type { useAIChat } from "./use-ai-chat";
import { ChatOriginalPreview } from "./chat-original-preview";

type Chat = ReturnType<typeof useAIChat>;
const controls = "min-h-11 rounded-lg border bg-background px-3 text-sm disabled:opacity-50";
const shortcuts = [ { id: "screening", icon: ScanSearch }, { id: "minutes", icon: FileText }, { id: "evidence", icon: ShieldCheck }, { id: "research", icon: Search } ];

export function ChatComposer({ chat, templates }: { chat: Chat; templates: AITemplate[] }) {
  const { draft, update, busy, loading } = chat;
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const sending = busy || chat.turns.some(turn => turn.status === "running");
  const canSend = !sending && !loading && draft.consent && draft.prompt.trim() && (!draft.useKnowledge || draft.projectId);
  return <div className="mx-auto w-full max-w-4xl px-3 pb-3 sm:px-6 sm:pb-4">
    <div aria-label="常用功能" className="mb-3 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
      <button type="button" disabled={sending} aria-pressed={draft.useKnowledge} onClick={() => { update({ useKnowledge: true }); textarea.current?.focus(); }} className="inline-flex min-h-11 items-center gap-2 rounded-xl border bg-card px-3 text-xs hover:bg-muted disabled:opacity-50"><LibraryBig className="size-4 text-primary" aria-hidden="true" />项目问答</button>
      {shortcuts.map(item => { const skill = AI_SKILLS.find(skill => skill.id === item.id)!; return <button key={item.id} type="button" disabled={sending} aria-pressed={draft.skill === item.id && !draft.templateId} onClick={() => { update({ skill: item.id, templateId: "" }); textarea.current?.focus(); }} className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-xs hover:bg-muted disabled:opacity-50 ${draft.skill === item.id && !draft.templateId ? "border-primary/40 bg-primary/5 text-primary" : "bg-card"}`}><item.icon className="size-4" aria-hidden="true" />{skill.name}</button>; })}
    </div>
    <form onSubmit={event => { event.preventDefault(); void chat.send(); }} className="rounded-2xl border bg-card p-3 shadow-sm focus-within:border-primary/40 sm:rounded-3xl">
      {chat.original && <ChatOriginalPreview original={chat.original} hasText={chat.original.hasText} />}
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm"><input type="checkbox" checked={draft.useKnowledge} disabled={sending} onChange={event => update({ useKnowledge: event.target.checked })} className="size-4 accent-primary" />查询知识库</label>
        {draft.useKnowledge && <select aria-label="选择项目" value={draft.projectId} disabled={sending} required onChange={event => update({ projectId: event.target.value })} className={`${controls} min-w-0 max-w-full flex-1 sm:max-w-72`}><option value="">选择项目</option>{chat.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>}
        {!draft.useKnowledge && <span className="text-xs text-muted-foreground">本次不检索项目资料</span>}
        {draft.useKnowledge && !draft.projectId && <span className="text-xs text-muted-foreground">请选择要查询的项目</span>}
      </div>
      {(materialsOpen || draft.context || draft.attachmentName) && <div className="mb-2 rounded-xl border bg-muted/30 p-3"><div className="mb-2 flex items-center justify-between gap-2"><span className="min-w-0 break-words text-xs font-medium">{draft.attachmentName || "附加资料"}</span><button type="button" aria-label="移除附加资料" disabled={sending} onClick={() => { update({ context: "", attachmentName: "" }); setMaterialsOpen(false); }} className="grid size-11 shrink-0 place-items-center rounded-lg hover:bg-muted"><X className="size-4" aria-hidden="true" /></button></div><label className="block text-xs text-muted-foreground">资料正文（可编辑）<textarea value={draft.context} disabled={sending} maxLength={50000} onChange={event => update({ context: event.target.value })} className="mt-2 max-h-40 min-h-20 w-full rounded-lg border bg-background p-2 text-sm" /></label></div>}
      <label className="sr-only" htmlFor="ai-chat-prompt">你的问题或任务</label>
      <textarea id="ai-chat-prompt" ref={textarea} value={draft.prompt} disabled={sending || loading} maxLength={20000} onChange={event => update({ prompt: event.target.value })} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); if (canSend) void chat.send(); } }} placeholder="描述你的问题，或上传资料开始工作…" className="max-h-40 min-h-16 w-full resize-y bg-transparent px-1 py-2 text-sm leading-7 outline-none disabled:opacity-60" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <label title="上传资料" className={`relative inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs hover:bg-muted focus-within:ring-2 focus-within:ring-ring ${sending ? "opacity-50" : ""}`}><Paperclip className="size-4" aria-hidden="true" /><span>附加资料</span><input type="file" aria-label="附加资料" disabled={sending} accept=".pdf,.docx,.txt,.md,.markdown" onChange={event => { void chat.extract(event.target.files?.[0]); event.target.value = ""; }} className="absolute inset-0 w-full cursor-pointer opacity-0" /></label>
          <button type="button" disabled={sending} onClick={() => setMaterialsOpen(!materialsOpen)} aria-expanded={materialsOpen || Boolean(draft.context)} className="min-h-11 rounded-lg px-2 text-xs hover:bg-muted disabled:opacity-50">粘贴正文</button>
          <select aria-label="任务类型" disabled={sending} value={draft.templateId ? `custom:${draft.templateId}` : draft.skill} onChange={event => { const value = event.target.value; update(value.startsWith("custom:") ? { templateId: value.slice(7) } : { skill: value, templateId: "" }); }} className="min-h-11 min-w-0 max-w-40 rounded-lg border-0 bg-muted/40 px-2 text-xs">{AI_SKILLS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}{templates.map(item => <option key={item.id} value={`custom:${item.id}`}>{item.name}（个人 Agent）</option>)}</select>
        </div>
        <button type="submit" aria-label="发送消息" disabled={!canSend} className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"><ArrowUp className="size-5" aria-hidden="true" /></button>
      </div>
      <label className="mt-2 flex cursor-pointer items-start gap-2 border-t pt-2 text-xs leading-5 text-muted-foreground"><input type="checkbox" disabled={sending} checked={draft.consent} onChange={event => update({ consent: event.target.checked })} className="mt-1 size-4 shrink-0 accent-primary" /><span>同意将本次输入、附加资料、相关对话上下文{draft.useKnowledge ? "及所选项目检索片段" : ""}发送至我的默认模型服务商处理。</span></label>
    </form>
    <p className="mt-2 text-center text-xs leading-5 text-muted-foreground">支持 PDF、DOCX、TXT、Markdown（20 MB 内） · AI 回答请核验 · Shift + Enter 换行</p>
  </div>;
}
