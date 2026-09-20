"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import type {ProjectAssistantRun,ProjectKnowledgeSource} from "@/ai/project-assistant-contracts";
const button="min-h-11 rounded-lg border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50";
const consentLabel="同意将本次问题及检索到的项目资料发送至我的默认模型服务商。";

export function ProjectAssistant({projectId,projectName,refreshToken}:{projectId:string;projectName:string;refreshToken:string}) {
  const [sources,setSources]=useState<ProjectKnowledgeSource[]>([]);
  const [runs,setRuns]=useState<ProjectAssistantRun[]>([]);
  const [selected,setSelected]=useState<ProjectAssistantRun|null>(null);
  const [prompt,setPrompt]=useState("");
  const [consent,setConsent]=useState(false);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [history,setHistory]=useState(false);
  const [reload,setReload]=useState(0);
  const pending=useRef(false);
  const retry=useRef<{prompt:string;key:string}|null>(null);
  const endpoint=`/api/v1/projects/${encodeURIComponent(projectId)}/assistant`;
  useEffect(()=>{
    const controller=new AbortController();
    void Promise.resolve().then(async()=>{
      if(controller.signal.aborted)return;
      setLoading(true);
      const response=await fetch(endpoint,{signal:controller.signal});
      const result=await response.json();if(!response.ok)throw new Error(result.error?.message||"加载项目知识失败。");
      if(!controller.signal.aborted){
        const received:ProjectAssistantRun[]=result.data.runs??[];
        setSources(result.data.sources??[]);setRuns(previous=>mergeRuns(previous,received));
        setSelected(previous=>previous?mergeRuns([previous],received).find(run=>run.id===previous.id)??previous:null);
        setError("");
      }
    }).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:"加载失败。");}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[endpoint,refreshToken,reload]);
  async function ask(event:React.FormEvent){
    event.preventDefault();if(!prompt.trim()||!consent||pending.current)return;
    pending.current=true;setBusy(true);setError("");setHistory(false);
    if(retry.current?.prompt!==prompt.trim())retry.current={prompt:prompt.trim(),key:crypto.randomUUID()};
    try{
      const response=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json","idempotency-key":retry.current.key},body:JSON.stringify({prompt:prompt.trim(),consent:true})});
      const result=await response.json();if(!response.ok){if(result.data?.status==="failed"){retry.current=null;setSelected(result.data);setConsent(false);}throw new Error(result.error?.message||result.data?.error||"项目问答失败，请重试。");}
      const run=result.data as ProjectAssistantRun;setSelected(run);setRuns(previous=>[run,...previous.filter(item=>item.id!==run.id)].slice(0,50));
      if(run.status!=="running")retry.current=null;setConsent(false);
    }catch(error){setError(error instanceof Error?error.message:"项目问答失败，请重试。");}
    finally{pending.current=false;setBusy(false);}
  }
  return <section className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-5" aria-labelledby="project-assistant-title">
    <div><h2 id="project-assistant-title" className="text-lg font-semibold">项目专属 AI 工作助手</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">围绕{projectName}的资料提问。助手会检索当前项目的相关正文，列出本次参考来源；资料不足时说明缺口。</p></div>
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{loading?"正在连接项目知识…":`已连接 ${sources.length} 项项目资料`}</span><button type="button" disabled={busy} className="min-h-9 px-2 text-primary" onClick={()=>{setError("");setReload(value=>value+1);}}>刷新知识与记录</button><Link href="/settings" className="min-h-9 content-center text-primary underline">个人 API 设置</Link></div>
    {!!sources.length&&<details className="text-sm"><summary className="cursor-pointer">查看项目知识来源</summary><ul className="mt-2 space-y-2">{sources.map(source=><li key={`${source.type}:${source.id}`} className="break-words"><a href={source.href} className="text-primary underline">{source.title}</a><span className="ml-2 text-xs text-muted-foreground">{({ready:"可引用",pending:"按需提取正文",failed:"暂无法读取",empty:"暂无正文",omitted:"本次未纳入"})[source.availability]}</span></li>)}</ul></details>}
    {error&&<p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
    <form onSubmit={ask} className="space-y-3">
      <label className="block text-sm font-medium">项目问题<textarea aria-label="项目问题" maxLength={8000} rows={4} disabled={busy} className="mt-2 w-full rounded-lg border bg-background p-3 font-normal" placeholder="例如：项目目前的核心技术优势是什么？有哪些资料需要进一步核验？" value={prompt} onChange={event=>{setPrompt(event.target.value);setConsent(false);}}/></label>
      <label className="flex items-start gap-2 text-sm leading-6"><input aria-label={consentLabel} type="checkbox" checked={consent} disabled={busy} className="mt-1 size-4 shrink-0" onChange={event=>setConsent(event.target.checked)}/>{consentLabel}</label>
      <button className={`${button} border-primary bg-primary text-primary-foreground hover:bg-primary/90`} disabled={busy||loading||!prompt.trim()||!consent}>{busy?"正在检索并回答…":"基于项目知识回答"}</button>
      <p className="text-xs leading-6 text-muted-foreground">调用个人模型会产生相应 API 费用。问答记录仅当前账号可见；新上传资料会在下一次提问时读取，不会自动训练模型。</p>
    </form>
    {selected&&<ProjectAnswer run={selected}/>}
    <div className="border-t pt-3"><button type="button" className={button} aria-expanded={history} onClick={()=>setHistory(value=>!value)}>我的项目问答记录</button>{history&&<div className="mt-3 space-y-3">{runs.length===0?<p className="text-sm text-muted-foreground">当前项目还没有你的问答记录。</p>:runs.map(run=><details key={run.id} className="rounded-lg border p-3"><summary className="cursor-pointer break-words text-sm">{run.prompt} · {run.status==="succeeded"?"已完成":run.status==="failed"?"失败":"执行中"}</summary><ProjectAnswer run={run}/></details>)}</div>}</div>
  </section>;
}
function ProjectAnswer({run}:{run:ProjectAssistantRun}){
  return <article className="mt-3 min-w-0 space-y-3 rounded-lg bg-muted/25 p-4" aria-label="项目助手回答"><p className="text-xs text-muted-foreground">{run.provider} / {run.model}</p><p className="whitespace-pre-wrap break-words text-sm leading-7">{run.status==="succeeded"?run.output:run.error||"正在处理，请稍后刷新记录。"}</p>{run.warnings.map((warning,index)=><p key={index} className="text-xs leading-6 text-muted-foreground">{warning}</p>)}{!!run.sources.length&&<div className="border-t pt-3"><h3 className="text-xs font-semibold">本次参考来源</h3><ul className="mt-2 space-y-2">{run.sources.map(source=><li key={`${source.reference}:${source.id}`} className="break-words text-sm"><a href={source.href} className="text-primary underline">[{source.reference}] {source.title}</a>{source.truncated&&<span className="ml-2 text-xs text-muted-foreground">相关片段</span>}</li>)}</ul></div>}</article>;
}

function mergeRuns(current:ProjectAssistantRun[],received:ProjectAssistantRun[]):ProjectAssistantRun[]{
  const records=new Map(current.map(run=>[run.id,run]));
  for(const run of received){const previous=records.get(run.id);if(!previous||run.updatedAt>previous.updatedAt||(run.updatedAt===previous.updatedAt&&previous.status==="running"&&run.status!=="running"))records.set(run.id,run);}
  return [...records.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,50);
}
