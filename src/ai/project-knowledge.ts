import type { DatabaseSync } from "node:sqlite";
import { readProjectDocument } from "@/workbench/project-document-content";
import { extractActivityDocumentPreview } from "@/workbench/activity-document-preview";
import type { ProjectKnowledgeSource } from "./project-assistant-contracts";

const MAX_SOURCES = 100;
const MAX_READ_SOURCES = 32;
const MAX_SOURCE_CHARS = 500000;
const MAX_TOTAL_CHARS = 4000000;
const MAX_PENDING_FILES = 6;
const MAX_TOTAL_FILE_BYTES = 32 * 1024 * 1024;
type SourceRow = { id: string; title: string; type: "document"|"knowledge"; parse_status: string; text_length: number; byte_length: number };
function sourceRows(db: DatabaseSync, projectId: string): SourceRow[] {
  return db.prepare(`SELECT id,original_name AS title,'document' AS type,parse_status,length(coalesce(extracted_text,'')) AS text_length,byte_length,updated_at FROM project_documents WHERE project_id=?
    UNION ALL SELECT id,title,'knowledge' AS type,status AS parse_status,length(content) AS text_length,0 AS byte_length,updated_at FROM knowledge_entries WHERE project_id=? AND status!='rejected'
    ORDER BY updated_at DESC,id LIMIT ?`).all(projectId,projectId,MAX_SOURCES) as unknown as SourceRow[];
}
function metadata(projectId: string, row: SourceRow): ProjectKnowledgeSource {
  return { id: row.id,type:row.type,title:row.title,href:row.type === "document" ? `/api/v1/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(row.id)}/content?download=1` : `/projects/${encodeURIComponent(projectId)}?view=knowledge#knowledge-${encodeURIComponent(row.id)}`,
    parseStatus:row.parse_status,availability:row.text_length>0 ? "ready" : row.type === "knowledge" ? "empty" : row.parse_status === "failed" ? "failed" : "pending",truncated:row.text_length>MAX_SOURCE_CHARS };
}
export function listProjectKnowledgeSources(db: DatabaseSync, projectId: string): ProjectKnowledgeSource[] { return sourceRows(db,projectId).map(row=>metadata(projectId,row)); }
export async function retrieveProjectKnowledge(db: DatabaseSync, projectId: string, prompt: string, storageRoot?: string) {
  const terms = [...new Set([...new Intl.Segmenter("zh",{granularity:"word"}).segment(prompt.toLowerCase())].filter(part=>part.isWordLike && part.segment.length>1).map(part=>part.segment))].slice(0,32);
  const rows = sourceRows(db,projectId).sort((a,b)=>score(b.title,terms)-score(a.title,terms));
  const warnings: string[] = [];
  const sources: ProjectKnowledgeSource[] = [];
  const chunks: { source: ProjectKnowledgeSource; text: string; score: number; index: number }[] = [];
  let characters=0; let pendingFiles=0; let fileBytes=0;
  if(rows.length>MAX_READ_SOURCES) warnings.push(`本次最多检索 ${MAX_READ_SOURCES} 份资料，更多资料尚未纳入，请缩小问题范围。`);
  for (const [sourceIndex,row] of rows.entries()) {
    let source = metadata(projectId,row);
    if(sourceIndex>=MAX_READ_SOURCES || characters>=MAX_TOTAL_CHARS) {sources.push({...source,availability:"omitted"});continue;}
    let text="";
    if(row.text_length>0) {
      const statement = row.type === "document" ? "SELECT substr(extracted_text,1,?) AS text FROM project_documents WHERE id=? AND project_id=?" : "SELECT substr(content,1,?) AS text FROM knowledge_entries WHERE id=? AND project_id=? AND status!='rejected'";
      text=String(db.prepare(statement).get(MAX_SOURCE_CHARS,row.id,projectId)?.text ?? "");
    } else if(row.type === "document") {
      if(pendingFiles>=MAX_PENDING_FILES || fileBytes+row.byte_length>MAX_TOTAL_FILE_BYTES) {sources.push({...source,availability:"omitted"});warnings.push(`${row.title}：达到本次即时解析数量或大小限制，尚未纳入。`);continue;}
      pendingFiles+=1;
      try {
        const file=readProjectDocument(db,projectId,row.id,storageRoot);fileBytes+=file.bytes.byteLength;
        if(fileBytes>MAX_TOTAL_FILE_BYTES) {sources.push({...source,availability:"omitted"});warnings.push(`${row.title}：超出本次解析大小限制。`);continue;}
        const extracted=await extractActivityDocumentPreview(file.kind,file.bytes);
        text=extracted.slice(0,MAX_SOURCE_CHARS);source={...source,truncated:extracted.length>MAX_SOURCE_CHARS};
      } catch {source={...source,availability:"failed"};warnings.push(`${row.title}：本次无法解析，未用于回答，请下载核对或重新上传。`);}
    }
    text=text.trim().slice(0,MAX_TOTAL_CHARS-characters);characters+=text.length;
    if(!text) {sources.push({...source,availability:source.availability === "failed" ? "failed" : "empty"});continue;}
    source={...source,availability:"ready"};sources.push(source);
    if(source.truncated) warnings.push(`${row.title}：本次最多读取前 ${MAX_SOURCE_CHARS} 个字符，后续内容未纳入。`);
    for(let start=0,index=0;start<text.length;start+=1700,index+=1) {
      const fragment=text.slice(start,start+1900);
      chunks.push({source,text:fragment,score:score(fragment,terms)+score(row.title,terms)*2,index});
    }
  }
  if(characters>=MAX_TOTAL_CHARS) warnings.push("本次资料读取达到总量限制，部分资料未纳入。");
  const sorted=chunks.sort((a,b)=>b.score-a.score || a.index-b.index);
  const selected: typeof chunks=[];const perSource=new Map<string,number>();
  for(const chunk of sorted) {
    const key=`${chunk.source.type}:${chunk.source.id}`;
    if((perSource.get(key)??0)>=3) continue;
    selected.push(chunk);perSource.set(key,(perSource.get(key)??0)+1);if(selected.length>=16)break;
  }
  const selectedSources: ProjectKnowledgeSource[]=[];const references=new Map<string,string>();
  for(const chunk of selected) {const key=`${chunk.source.type}:${chunk.source.id}`;if(!references.has(key)){const reference=`S${references.size+1}`;references.set(key,reference);selectedSources.push({...chunk.source,reference});}}
  if(chunks.length>selected.length) warnings.push("回答使用与问题最相关的资料片段，未发送全部正文；未找到的信息需要继续核验。");
  const context=selected.map(chunk=>`[${references.get(`${chunk.source.type}:${chunk.source.id}`)}] ${chunk.source.title}${chunk.source.type === "knowledge" && chunk.source.parseStatus === "draft" ? "（知识草稿，待审核）" : ""}\n${chunk.text}`).join("\n\n");
  return { context,sources:selectedSources,warnings:[...new Set(warnings)],allSources:sources };
}
function score(text: string,terms: string[]): number { const normalized=text.toLowerCase();return terms.reduce((sum,term)=>sum+(normalized.includes(term)?1:0),0); }
