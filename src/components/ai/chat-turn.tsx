"use client";
import { useState } from "react";
import { Bot, Copy, Download, FileText, LibraryBig } from "lucide-react";
import type { ChatTurn } from "@/ai/chat-contracts";

export function ChatTurnView({ turn, projectName }: { turn: ChatTurn; projectName?: string }) {
  const [notice, setNotice] = useState("");
  async function copy() {
    try { await navigator.clipboard.writeText(turn.output); setNotice("已复制回答。"); }
    catch { setNotice("复制失败，请选中回答文字复制。"); }
  }
  function download() {
    const sources = turn.sources.filter(source => source.reference).map(source => `${source.reference} ${source.title}`).join("\n");
    const url = URL.createObjectURL(new Blob([`# ${turn.prompt}\n\n${turn.output}\n\n${sources}\n\n模型：${turn.provider} / ${turn.model}\n生成时间：${turn.createdAt}\n`], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `AI结果-${turn.id}.md`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <article className="space-y-6" aria-label={`问题：${turn.prompt.slice(0, 80)}`}>
    <div className="ml-auto max-w-[90%] rounded-2xl rounded-tr-sm bg-muted px-5 py-4 sm:max-w-[85%]">
      <p className="whitespace-pre-wrap break-words text-sm leading-7">{turn.prompt}</p>
      {turn.attachmentName && <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><FileText className="size-3.5 shrink-0" aria-hidden="true" />{turn.attachmentName}</p>}
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><LibraryBig className="size-3.5 shrink-0" aria-hidden="true" />{turn.useKnowledge ? `项目知识库 · ${projectName || "所选项目"}` : "未查询知识库"}</p>
    </div>
    <div className="flex gap-3 sm:gap-4">
      <span className="mt-1 grid size-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Bot className="size-4" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <p className="mb-2 text-xs font-medium text-muted-foreground">工作助手{turn.model ? ` · ${turn.model}` : ""}</p>
        {turn.status === "succeeded" ? <div className="whitespace-pre-wrap break-words text-sm leading-8">{turn.output}</div> : <p className={`text-sm leading-7 ${turn.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>{turn.error || "正在处理，请稍后刷新对话。"}</p>}
        {turn.sources.some(source => source.reference) && <section aria-label="回答来源" className="mt-4 rounded-xl border bg-muted/25 p-3"><h3 className="mb-2 text-xs font-semibold">本次检索来源</h3><div className="flex flex-wrap gap-2">{turn.sources.filter(source => source.reference).map(source => <a key={`${source.type}-${source.id}`} href={source.href} target="_blank" rel="noreferrer" className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs text-primary hover:bg-muted"><FileText className="size-3.5 shrink-0" aria-hidden="true" /><span className="break-words">{source.reference} {source.title}</span></a>)}</div></section>}
        {turn.warnings.map((warning, index) => <p key={index} className="mt-2 text-xs leading-5 text-muted-foreground">{warning}</p>)}
        {turn.status === "succeeded" && <div className="mt-2 flex flex-wrap items-center gap-1"><button type="button" onClick={() => void copy()} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs text-muted-foreground hover:bg-muted"><Copy className="size-3.5" aria-hidden="true" />复制回答</button><button type="button" onClick={download} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs text-muted-foreground hover:bg-muted"><Download className="size-3.5" aria-hidden="true" />下载结果</button>{notice && <span role="status" className="text-xs text-muted-foreground">{notice}</span>}</div>}
      </div>
    </div>
  </article>;
}
