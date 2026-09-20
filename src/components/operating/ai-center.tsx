"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bot, History, LoaderCircle, MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Settings2, Sparkles, Workflow } from "lucide-react";
import { AI_SKILLS, type AIRun, type AITemplate } from "@/ai/workspace-contracts";
import { AISettings } from "@/components/ai/ai-settings";
import { AIStudio } from "@/components/ai/ai-studio";
import { AIRunResult } from "@/components/ai/ai-run-result";
import { ChatComposer } from "@/components/ai/chat-composer";
import { ChatTurnView } from "@/components/ai/chat-turn";
import { useAIChat } from "@/components/ai/use-ai-chat";

const tabs = [{ id: "copilot", label: "工作助手", icon: MessageSquare }, { id: "runs", label: "运行记录", icon: History }, { id: "skills", label: "Skills", icon: Sparkles }, { id: "studio", label: "Agent Studio", icon: Workflow }, { id: "providers", label: "API 与模型", icon: Settings2 }];
const control = "min-h-11 rounded-lg border px-3 text-sm hover:bg-muted disabled:opacity-50";

export function AiCenter({ initialView }: { initialView: string }) {
  const [active, setActive] = useState(tabs.some(item => item.id === initialView) ? initialView : "copilot");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [runs, setRuns] = useState<AIRun[]>([]);
  const [templates, setTemplates] = useState<AITemplate[]>([]);
  const [workspaceError, setWorkspaceError] = useState("");
  const chat = useAIChat();
  const transcript = useRef<HTMLDivElement>(null);
  const refreshWorkspace = useCallback(async () => {
    const responses = await Promise.all([fetch("/api/v1/ai/runs"), fetch("/api/v1/ai/templates")]);
    const values = await Promise.all(responses.map(response => response.json()));
    if (responses.some(response => !response.ok)) throw new Error("加载运行记录或个人 Agent 失败，请刷新重试。");
    setRuns(values[0].data); setTemplates(values[1].data);
  }, []);
  useEffect(() => { void Promise.resolve().then(refreshWorkspace).catch(error => setWorkspaceError(error.message)); }, [refreshWorkspace]);
  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [chat.turns.length, chat.busy]);
  function navigate(view: string) {
    setActive(view); setSidebarOpen(false);
    if (view === "copilot") void chat.loadModel().catch(() => setWorkspaceError("当前模型状态读取失败，请刷新。"));
  }
  const conversation = chat.conversations.find(item => item.id === chat.conversationId);
  return <div className="relative flex h-[calc(100dvh-9rem)] min-h-[38rem] w-full bg-background md:h-[calc(100dvh-4rem)] md:min-h-[36rem]">
    <aside aria-label="对话记录" className={`${sidebarOpen ? "absolute inset-y-0 left-0 z-20 flex w-[min(18rem,90%)] shadow-xl" : "hidden"} shrink-0 flex-col border-r bg-muted/30 p-3 lg:static lg:flex lg:w-52 lg:shadow-none xl:w-56`}>
      <div className="flex items-center gap-2"><button type="button" disabled={chat.busy} onClick={() => { chat.newChat(); navigate("copilot"); }} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-primary/25 bg-primary/5 px-3 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50"><Plus className="size-4" aria-hidden="true" />新建对话</button><button type="button" aria-label="收起对话记录" onClick={() => setSidebarOpen(false)} className="grid size-11 place-items-center rounded-lg hover:bg-muted lg:hidden"><PanelLeftClose className="size-4" aria-hidden="true" /></button></div>
      <div className="mt-6 flex items-center justify-between px-2"><h2 className="text-xs font-medium text-muted-foreground">最近对话</h2><span className="text-xs text-muted-foreground">仅自己可见</span></div>
      <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto">
        {chat.conversations.length === 0 && <p className="px-2 py-4 text-xs leading-6 text-muted-foreground">提问后会保存在这里，随时继续聊。</p>}
        {chat.conversations.map(item => <button key={item.id} type="button" disabled={chat.busy} title={item.title} aria-current={active === "copilot" && chat.conversationId === item.id ? "page" : undefined} onClick={() => { navigate("copilot"); void chat.open(item.id); }} className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50 ${active === "copilot" && chat.conversationId === item.id ? "bg-muted font-medium" : ""}`}><MessageSquare className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="truncate">{item.title}</span></button>)}
      </div>
      <nav aria-label="AI 工作台功能" className="mt-3 space-y-0.5 border-t pt-3">{tabs.map(item => <button key={item.id} type="button" disabled={chat.busy} aria-current={active === item.id ? "page" : undefined} onClick={() => navigate(item.id)} className={`flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-xs hover:bg-muted disabled:opacity-50 ${active === item.id ? "text-primary" : "text-muted-foreground"}`}><item.icon className="size-4" aria-hidden="true" />{item.label}</button>)}</nav>
    </aside>
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-2 border-b px-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2"><button type="button" aria-label="展开对话记录" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)} className="grid size-11 shrink-0 place-items-center rounded-lg hover:bg-muted lg:hidden"><PanelLeftOpen className="size-4" aria-hidden="true" /></button><div className="min-w-0"><h1 className="text-base font-semibold">AI 工作台</h1><p className="truncate text-xs text-muted-foreground">{active === "copilot" ? conversation?.title || "你的项目工作助手" : tabs.find(tab => tab.id === active)?.label}</p></div></div>
        <div className="flex min-w-0 items-center gap-1"><button type="button" disabled={chat.busy} title="选择个人 API 与模型" onClick={() => navigate("providers")} className="hidden min-h-11 max-w-48 items-center gap-2 truncate rounded-lg px-3 text-xs text-muted-foreground hover:bg-muted sm:flex"><Bot className="size-4 shrink-0" aria-hidden="true" /><span className="truncate">{chat.model || "配置个人模型"}</span></button><Link href="/settings" title="个人 API 设置" className="grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted" aria-label="个人 API 设置"><Settings2 className="size-4" aria-hidden="true" /></Link>{active === "copilot" && <button type="button" aria-label="刷新对话" disabled={chat.busy || chat.loading} onClick={() => void chat.refresh()} className="grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-50"><RefreshCw className="size-4" aria-hidden="true" /></button>}</div>
      </header>
      {workspaceError && <p role="alert" className="mx-4 mt-3 rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{workspaceError}</p>}
      {active === "copilot" ? <>
        <div ref={transcript} role="log" aria-label="对话内容" aria-live="polite" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-8">
          {chat.loading ? <p role="status" className="py-8 text-center text-sm text-muted-foreground">正在读取对话…</p> : chat.turns.length === 0 ? <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center py-0 text-center"><span className="mb-3 grid size-10 place-items-center rounded-2xl bg-primary/10 text-primary"><Sparkles className="size-6" aria-hidden="true" /></span><h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">有什么项目工作需要我帮忙？</h2><p className="mt-3 max-w-md text-sm leading-7 text-muted-foreground">分析资料、整理纪要、核验证据。 选一个项目，让回答有据可查。</p></div> : <div className="mx-auto max-w-3xl space-y-10 pb-4">{chat.turns.map(turn => <ChatTurnView key={turn.id} turn={turn} projectName={chat.projects.find(project => project.id === turn.projectId)?.name} />)}</div>}
          {chat.busy && <div role="status" className="mx-auto mt-5 flex max-w-3xl items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{chat.draft.useKnowledge ? "正在检索项目资料并处理问题…" : "正在处理，请稍候…"}</div>}
        </div>
        {(chat.error || chat.note) && <div className="mx-auto w-full max-w-4xl px-4 pb-2 sm:px-6">{chat.error && <p role="alert" className="rounded-xl border border-destructive/30 px-3 py-2 text-sm leading-6 text-destructive">{chat.error}</p>}{chat.note && <p role="status" className="px-1 py-1 text-xs leading-5 text-muted-foreground">{chat.note}</p>}</div>}
        <ChatComposer chat={chat} templates={templates} />
      </> : <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {active === "providers" && <AISettings />}
        {active === "studio" && <AIStudio templates={templates} refresh={refreshWorkspace} onUse={id => { chat.update({ templateId: id }); navigate("copilot"); }} />}
        {active === "skills" && <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{AI_SKILLS.map(item => <article key={item.id} className="rounded-xl border bg-card p-5"><h2 className="font-semibold">{item.name}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p><button type="button" className={`${control} mt-4`} onClick={() => { chat.update({ skill: item.id, templateId: "" }); navigate("copilot"); }}>使用{item.name}</button></article>)}</section>}
        {active === "runs" && <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">我的运行记录 · 最近 50 条</h2><button type="button" className={control} onClick={() => void refreshWorkspace().catch(error => setWorkspaceError(error.message))}>刷新记录</button></div><p className="text-xs text-muted-foreground">保留此前的单次任务结果，新对话请在最近对话中查看。</p>{runs.length === 0 ? <p className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">还没有历史单次任务记录。</p> : runs.map(run => <details key={run.id} className="rounded-xl border bg-card p-4"><summary className="cursor-pointer text-sm font-medium">{run.prompt.slice(0, 80)} · {({ running: "执行中", succeeded: "已完成", failed: "失败" })[run.status]}</summary><div className="mt-3">{run.status === "succeeded" ? <AIRunResult run={run} /> : <p className="text-sm text-destructive">{run.error || "任务执行中，请稍后刷新。"}</p>}</div></details>)}</section>}
      </div>}
    </section>
  </div>;
}
