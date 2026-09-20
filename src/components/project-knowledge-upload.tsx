"use client";
import {useRef,useState} from "react";
import {useRouter} from "next/navigation";

export function ProjectKnowledgeUpload({projectId,version,onUploaded}:{projectId:string;version:number;onUploaded:()=>void}) {
  const router=useRouter();
  const [file,setFile]=useState<File|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const revision=useRef(version);
  const pending=useRef(false);
  const retry=useRef<{file:File;key:string}|null>(null);
  const input=useRef<HTMLInputElement>(null);
  async function upload(event:React.FormEvent) {
    event.preventDefault();if(!file||pending.current)return;
    if(file.size>20*1024*1024){setError("单文件不能超过 20 MB。");return;}
    pending.current=true;setBusy(true);setError("");setMessage("");
    if(retry.current?.file!==file)retry.current={file,key:crypto.randomUUID()};
    const form=new FormData();form.set("file",file);form.set("expectedVersion",String(Math.max(version,revision.current)));form.set("externalPolicy","local_only");
    try {
      const response=await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/documents`,{method:"POST",headers:{"idempotency-key":retry.current.key},body:form});
      const result=await response.json();if(!response.ok)throw new Error(result.error?.message||"上传失败，请重试。");
      revision.current=result.data.projectVersion;retry.current=null;setFile(null);if(input.current)input.current.value="";
      setMessage("资料已加入项目知识库，可向项目助手提问。");onUploaded();router.refresh();
    }catch(error){setError(error instanceof Error?error.message:"上传失败，请重试。");}
    finally{pending.current=false;setBusy(false);}
  }
  return <form onSubmit={upload} className="space-y-3 rounded-xl border bg-muted/20 p-4">
    <label className="block text-sm font-medium">知识库文件<input ref={input} aria-label="知识库文件" type="file" disabled={busy} accept=".pdf,.docx,.txt,.md,.markdown" className="mt-2 block w-full text-sm" onChange={event=>{setFile(event.target.files?.[0]??null);setMessage("");setError("");}}/></label>
    <p className="text-xs leading-6 text-muted-foreground">支持 PDF、Word、TXT、Markdown，单份最多 20 MB。原件保存在当前项目，可预览、下载和批注；向助手提问并确认后，相关正文片段才会发送给你的模型。</p>
    <button type="submit" disabled={busy||!file} className="min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">{busy?"正在上传…":"上传到知识库"}</button>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{message&&<p role="status" className="text-sm text-primary">{message}</p>}
  </form>;
}
