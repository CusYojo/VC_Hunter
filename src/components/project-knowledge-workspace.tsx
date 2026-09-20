"use client";
import {useState} from "react";
import {ProjectDocuments} from "@/components/project-documents";
import {ProjectKnowledgeUpload} from "@/components/project-knowledge-upload";
import {ProjectAssistant} from "@/components/ai/project-assistant";
import type {ProjectDocumentView} from "@/workbench/project-document-contracts";
export interface ProjectKnowledgeEntry {id:string;title:string;content:string;type:string;status:string;sourceType:string;createdAt:string}
export function ProjectKnowledgeWorkspace({projectId,projectName,version,documents,knowledge}:{projectId:string;projectName:string;version:number;documents:ProjectDocumentView[];knowledge:ProjectKnowledgeEntry[]}) {
  const [query,setQuery]=useState("");const [revision,setRevision]=useState(0);
  const filtered=knowledge.filter(entry=>[entry.title,entry.content,entry.type,entry.sourceType].join(" ").toLocaleLowerCase("zh-CN").includes(query.trim().toLocaleLowerCase("zh-CN")));
  const refreshToken=`${version}:${revision}:${documents.map(document=>`${document.id}:${document.parseStatus}`).join(",")}`;
  return <section className="space-y-5 py-2">
    <div><h2 className="text-xl font-semibold">项目知识库</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">上传项目资料，保留原件和知识条目。右侧助手会按问题检索本项目内容，回答可回到具体来源。</p></div>
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-5">
        <ProjectKnowledgeUpload key={projectId} projectId={projectId} version={version} onUploaded={()=>setRevision(value=>value+1)}/>
        <ProjectDocuments projectId={projectId} documents={documents}/>
        <section className="space-y-3 rounded-xl border p-4"><h3 className="font-semibold">知识条目 · {filtered.length}/{knowledge.length}</h3><label className="block"><span className="sr-only">搜索项目知识库</span><input aria-label="搜索项目知识库" type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索标题、内容或来源" className="min-h-11 w-full rounded-lg border px-3 text-sm"/></label>{knowledge.length===0?<p className="text-sm text-muted-foreground">暂无知识草稿。上传原件后即可向项目助手提问，本地解析完成后也会生成知识草稿。</p>:filtered.length===0?<p className="text-sm text-muted-foreground">没有匹配内容。</p>:filtered.map(entry=><article id={`knowledge-${entry.id}`} key={entry.id} className="space-y-2 rounded-lg border p-3"><p className="text-xs text-muted-foreground">{entry.status==="approved"?"已入库":entry.status==="rejected"?"已拒绝，不用于问答":"待审核草稿"} · {entry.type}</p><h4 className="break-words font-medium">{entry.title}</h4><p className="whitespace-pre-wrap break-words text-sm leading-6">{entry.content}</p><p className="text-xs text-muted-foreground">来源：{entry.sourceType}</p></article>)}</section>
      </div>
      <ProjectAssistant key={projectId} projectId={projectId} projectName={projectName} refreshToken={refreshToken}/>
    </div>
  </section>;
}
