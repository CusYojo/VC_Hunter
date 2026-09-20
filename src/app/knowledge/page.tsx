import { requirePageUser } from "@/security/page-auth";
import Link from "next/link";
import { getAppDatabase } from "@/db/app";
import { SqliteWorkbenchRepository } from "@/workbench/repository";
import { KnowledgeEntries } from "@/components/knowledge-entries";
import { HubPage, HubHeader } from "@/components/operating/hub-layout";

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ query?: string }> }) {
  await requirePageUser();
  const query = String((await searchParams).query ?? "").trim().slice(0, 200);
  const database = getAppDatabase();
  const entries = new SqliteWorkbenchRepository(database).listKnowledge().filter((item) => !query || `${item.title}\n${item.content}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const documents = database.prepare(`SELECT d.id,d.project_id,d.original_name,d.parse_status,d.extracted_text,p.name AS project_name
    FROM project_documents d JOIN projects p ON p.id=d.project_id
    WHERE instr(lower(d.original_name || ' ' || coalesce(d.extracted_text,'') || ' ' || p.name),lower(?))>0
    ORDER BY d.created_at DESC LIMIT 100`).all(query) as unknown as Array<{ id: string; project_id: string; original_name: string; parse_status: string; extracted_text: string | null; project_name: string }>;
  return <HubPage><HubHeader eyebrow="Project knowledge" title="项目知识库" description="检索项目上传资料与带来源的知识沉淀" source="real" />
    <form action="/knowledge" className="flex gap-3"><label className="min-w-0 flex-1"><span className="sr-only">搜索项目资料和知识</span><input name="query" defaultValue={query} maxLength={200} placeholder="搜索文件名称、项目或资料内容" className="h-11 w-full rounded-md border border-input bg-white px-3 text-sm" /></label><button className="rounded-md bg-primary px-5 text-sm text-white" type="submit">搜索</button></form>
    <section><div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">项目文件（{documents.length}）</h2><Link href="/projects" className="text-sm text-primary">进入项目上传资料</Link></div>
      <div className="divide-y rounded-lg border bg-white">{documents.length ? documents.map((document) => <article key={document.id} className="p-4"><Link href={`/projects/${document.project_id}`} className="font-medium text-primary">{document.original_name}</Link><p className="mt-1 text-xs text-muted-foreground">{document.project_name} · {document.parse_status === "succeeded" ? "已解析，可检索内容" : "待解析或解析失败，仅可搜索文件名"}</p>{query && document.extracted_text && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{document.extracted_text.slice(Math.max(0, document.extracted_text.toLowerCase().indexOf(query.toLowerCase()) - 50), Math.max(0, document.extracted_text.toLowerCase().indexOf(query.toLowerCase()) - 50) + 200)}</p>}</article>) : <p className="p-6 text-sm text-muted-foreground">暂无匹配资料。上传到项目的文件会自动归档到这里。</p>}</div></section>
    <section><h2 className="mb-3 text-lg font-semibold">知识沉淀（{entries.length}）</h2><KnowledgeEntries initialEntries={entries} /></section>
  </HubPage>;
}
