import type { DatabaseSync } from "node:sqlite";
import type { WorkspaceSearchResult } from "./search-contracts";
/** The same single-workspace entity tables exposed by the authenticated list routes. */
export function searchWorkspace(database: DatabaseSync, query: string): WorkspaceSearchResult[] {
  const term = query.trim();
  if (!term) return [];
  if (term.length > 100) throw new Error("搜索关键词不能超过 100 字。");
  const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
  const sources = [
    { type: "project", sql: "SELECT id,name AS title,substr(executive_summary,1,500) AS snippet FROM projects WHERE name LIKE ? ESCAPE '\\' OR executive_summary LIKE ? ESCAPE '\\' ORDER BY name LIMIT 6", href: (id: string) => `/projects/${encodeURIComponent(id)}` },
    { type: "investor", sql: "SELECT id,name AS title,coalesce(headquarters,'') AS snippet FROM investors WHERE name LIKE ? ESCAPE '\\' OR aliases_json LIKE ? ESCAPE '\\' ORDER BY name LIMIT 6", href: (id: string) => `/investors/${encodeURIComponent(id)}` },
    { type: "person", sql: "SELECT id,name AS title,coalesce(current_organization,'') || ' · ' || coalesce(current_title,'') AS snippet FROM people WHERE name LIKE ? ESCAPE '\\' OR aliases_json LIKE ? ESCAPE '\\' ORDER BY name LIMIT 6", href: (id: string) => `/resources?view=people#person-${encodeURIComponent(id)}` },
    { type: "technology", sql: "SELECT id,name AS title,substr(definition,1,500) AS snippet FROM technologies WHERE name LIKE ? ESCAPE '\\' OR definition LIKE ? ESCAPE '\\' ORDER BY name LIMIT 6", href: (id: string) => `/research?view=technology#technology-${encodeURIComponent(id)}` },
    { type: "candidate", sql: "SELECT id,subject_name AS title,substr(discovery_reason || ' · ' || investment_summary,1,500) AS snippet FROM intelligence_candidates WHERE status='pending_review' AND (subject_name LIKE ? ESCAPE '\\' OR discovery_reason LIKE ? ESCAPE '\\') ORDER BY event_date DESC LIMIT 6", href: (id: string) => `/projects?view=discovery#intelligence-${encodeURIComponent(id)}` },
    { type: "knowledge", sql: "SELECT id,title,substr(content,1,500) AS snippet FROM knowledge_entries WHERE title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' ORDER BY title LIMIT 6", href: (_id: string, title: string) => `/knowledge?query=${encodeURIComponent(title)}` },
  ] as const;
  return sources.flatMap((source) => {
    const rows = database.prepare(source.sql).all(pattern, pattern) as unknown as Array<{ id: string; title: string; snippet: string }>;
    return rows.map((row) => ({ id: row.id, type: source.type, title: row.title, snippet: row.snippet.slice(0, 180), href: source.href(row.id, row.title) }));
  });
}
