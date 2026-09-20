"use client";
import type { AIRun } from "@/ai/workspace-contracts";
export function AIRunResult({ run }: { run: AIRun }) {
  function download() {
    const url = URL.createObjectURL(new Blob([`# ${run.prompt}\n\n${run.output}\n\n模型：${run.provider} / ${run.model}\n生成时间：${run.createdAt}\n`], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `AI结果-${run.id}.md`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="rounded-xl border bg-card p-5"><header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">生成结果</h2><p className="mt-1 text-xs text-muted-foreground">{run.provider} · {run.model} · {new Date(run.createdAt).toLocaleString("zh-CN")}</p></div><button type="button" onClick={download} className="min-h-11 rounded-lg border px-3 text-sm hover:bg-muted">下载结果</button></header><p className="mt-3 text-xs text-muted-foreground">AI 生成内容，使用前请核验事实、来源与结论。</p><div className="mt-4 whitespace-pre-wrap break-words text-sm leading-7">{run.output}</div></section>;
}
